"""Auth credential models and data-access layer."""

from __future__ import annotations

import logging
import uuid
from typing import Optional

import bcrypt
from open_webui.internal.db import Base, JSONField, get_async_db_context
from open_webui.models.users import User, UserModel, UserProfileImageResponse, Users
from open_webui.utils.validate import validate_profile_image_url
from pydantic import BaseModel, field_validator
from sqlalchemy import JSON, Boolean, Column, String, Text, delete, false, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

# Pre-computed hash verified on signin paths that lack a real credential
# (unknown user, inactive account) so response timing cannot reveal
# whether an account exists (CWE-208).
PLACEHOLDER_HASH = bcrypt.hashpw(b'placeholder', bcrypt.gensalt()).decode('utf-8')


class Auth(Base):  # credential ↔ user linkage
    """Maps a user ID to an email/password pair with an active flag."""

    __tablename__ = 'auth'

    id = Column(String, primary_key=True, unique=True)  # mirrors User.id
    email = Column(String)  # login address, kept in sync with User.email
    password = Column(Text)  # argon2 / bcrypt hash
    active = Column(Boolean)  # account soft-disable toggle

    # Second factor. The secret is encrypted (see utils/two_factor.py); the
    # flag is separate from it because a secret exists while enrolment is only
    # half done, and a half-finished enrolment must not lock anyone out.
    totp_secret = Column(Text, nullable=True)
    totp_enabled = Column(Boolean, nullable=False, default=False, server_default=false())
    totp_recovery = Column(JSON, nullable=True)  # hashed, one array per account


class AuthModel(BaseModel):
    """Pydantic mirror of the ``auth`` table row."""

    id: str
    email: str
    password: str
    active: bool = True


class Token(BaseModel):
    """JWT bearer-token response wrapper."""

    token: str
    token_type: str


class ApiKey(BaseModel):
    api_key: str | None = None


class SigninResponse(Token, UserProfileImageResponse):
    pass


class SigninForm(BaseModel):
    email: str
    password: str
    # Second factor, when the account has one. Sent with the password rather
    # than exchanged for a challenge token: one fewer short-lived credential to
    # mint, expire and get wrong, and the password is already in flight here.
    code: Optional[str] = None


class LdapForm(BaseModel):
    user: str
    password: str


class ProfileImageUrlForm(BaseModel):
    profile_image_url: str


class UpdatePasswordForm(BaseModel):
    password: str
    new_password: str


class SignupForm(BaseModel):
    name: str
    email: str
    password: str
    profile_image_url: str | None = '/user.png'

    @field_validator('profile_image_url')
    @classmethod
    def check_profile_image_url(cls, v: str | None) -> str | None:
        if v is not None:
            return validate_profile_image_url(v)
        return v


class AddUserForm(SignupForm):
    role: str | None = 'pending'


# --- data-access layer ---


class AuthsTable:
    """Provides CRUD operations for the Auth ↔ User lifecycle."""

    async def insert_new_auth(
        self,
        email: str,
        password: str,
        name: str,
        profile_image_url: str = '/user.png',
        role: str = 'pending',
        oauth: dict | None = None,
        db: AsyncSession | None = None,
    ) -> UserModel | None:
        """Create an Auth + User pair inside a single transaction."""
        async with get_async_db_context(db) as session:
            log.info('insert_new_auth')

            new_id = str(uuid.uuid4())

            credential = Auth(
                id=new_id,
                email=email,
                password=password,
                active=True,
            )
            session.add(credential)

            try:
                created_user = await Users.insert_new_user(
                    new_id,
                    name,
                    email,
                    profile_image_url,
                    role,
                    oauth=oauth,
                    db=session,
                )
                await session.commit()
            except IntegrityError:
                await session.rollback()
                raise
            return created_user if credential and created_user else None

    async def authenticate_user(
        self,
        email: str,
        verify_password: callable,
        db: AsyncSession | None = None,
    ) -> UserModel | None:
        """Verify email + password credentials and return the matching user."""
        log.info('authenticate_user: %s', email)
        resolved = await Users.get_user_by_email(email, db=db)
        if not resolved:
            await verify_password(PLACEHOLDER_HASH)
            return
        # load the credential row and verify the password hash
        async with get_async_db_context(db) as session:
            credential = await session.get(Auth, resolved.id)
            if not credential or not credential.active:
                await verify_password(PLACEHOLDER_HASH)
                return
            if not await verify_password(credential.password):
                return
            return resolved

    async def authenticate_user_by_api_key(
        self,
        api_key: str,
        db: AsyncSession | None = None,
    ) -> UserModel | None:
        """Look up the user that owns the given API key."""
        log.info('authenticate_user_by_api_key')
        if not api_key:
            return
        # delegate to the Users model for the actual lookup
        return await Users.get_user_by_api_key(api_key, db=db)

    async def authenticate_user_by_email(
        self,
        email: str,
        db: AsyncSession | None = None,
    ) -> UserModel | None:
        """Single-query auth via JOIN on Auth ↔ User, filtered by active flag."""
        log.info('authenticate_user_by_email: %s', email)
        # single JOIN avoids N+1 — returns (Auth, User) tuple or None
        async with get_async_db_context(db) as session:
            joined_query = (
                select(Auth, User).join(User, Auth.id == User.id).where(Auth.email == email, Auth.active.is_(True))
            )
            match = (await session.execute(joined_query)).first()
            if not match:
                return
            _, found_user = match
            return UserModel.model_validate(found_user)

    async def update_email_by_id(
        self,
        user_id: str,
        email: str,
        db: AsyncSession | None = None,
    ) -> bool:
        """Set a new email on the auth record and propagate to the user row."""
        async with get_async_db_context(db) as session:
            auth_row = await session.get(Auth, user_id)
            if auth_row is None:
                return False
            auth_row.email = email
            await session.commit()
            await Users.update_user_by_id(user_id, {'email': email}, db=session)
            return True
        # --- password modification ---

    async def update_user_password_by_id(
        self,
        user_id: str,
        new_password: str,
        db: AsyncSession | None = None,
    ) -> bool:
        """Set a new password hash for an existing user."""
        async with get_async_db_context(db) as session:
            auth_row = await session.get(Auth, user_id)
            if auth_row is None:
                return False
            auth_row.password = new_password
            await session.commit()
            return True

    async def get_two_factor_by_id(
        self,
        user_id: str,
        db: AsyncSession | None = None,
    ) -> tuple[bool, str | None, list[str]]:
        """Whether a second factor is on, its sealed secret, and what is left of the recovery codes."""
        async with get_async_db_context(db) as session:
            auth_row = await session.get(Auth, user_id)
            if auth_row is None:
                return False, None, []
            return (
                bool(auth_row.totp_enabled),
                auth_row.totp_secret,
                list(auth_row.totp_recovery or []),
            )

    async def start_two_factor_by_id(
        self,
        user_id: str,
        sealed_secret: str,
        db: AsyncSession | None = None,
    ) -> bool:
        """Stage a secret without turning anything on.

        Enrolment is two steps because the first one can fail silently: a key
        that never reached the authenticator would otherwise lock the account
        on the next sign-in. Nothing is enforced until a code proves the app
        has it.
        """
        async with get_async_db_context(db) as session:
            auth_row = await session.get(Auth, user_id)
            if auth_row is None:
                return False
            auth_row.totp_secret = sealed_secret
            auth_row.totp_enabled = False
            auth_row.totp_recovery = None
            await session.commit()
            return True

    async def enable_two_factor_by_id(
        self,
        user_id: str,
        recovery_hashes: list[str],
        db: AsyncSession | None = None,
    ) -> bool:
        """Turn it on, once a code has proved the secret arrived."""
        async with get_async_db_context(db) as session:
            auth_row = await session.get(Auth, user_id)
            if auth_row is None or not auth_row.totp_secret:
                return False
            auth_row.totp_enabled = True
            auth_row.totp_recovery = recovery_hashes
            await session.commit()
            return True

    async def set_recovery_codes_by_id(
        self,
        user_id: str,
        recovery_hashes: list[str],
        db: AsyncSession | None = None,
    ) -> bool:
        """Replace what is left of the recovery codes - one was spent, or all were regenerated."""
        async with get_async_db_context(db) as session:
            auth_row = await session.get(Auth, user_id)
            if auth_row is None:
                return False
            auth_row.totp_recovery = recovery_hashes
            await session.commit()
            return True

    async def disable_two_factor_by_id(
        self,
        user_id: str,
        db: AsyncSession | None = None,
    ) -> bool:
        """Turn it off and forget the secret, so re-enrolling starts fresh."""
        async with get_async_db_context(db) as session:
            auth_row = await session.get(Auth, user_id)
            if auth_row is None:
                return False
            auth_row.totp_enabled = False
            auth_row.totp_secret = None
            auth_row.totp_recovery = None
            await session.commit()
            return True

    async def delete_auth_by_id(
        self,
        id: str,
        db: AsyncSession | None = None,
    ) -> bool:
        """Remove a user and their auth credential in one transaction."""
        async with get_async_db_context(db) as session:
            if not await Users.delete_user_by_id(id, db=session):
                return False
            await session.execute(delete(Auth).where(Auth.id == id))
            await session.commit()
            return True


Auths = AuthsTable()  # singleton — module-level instance
