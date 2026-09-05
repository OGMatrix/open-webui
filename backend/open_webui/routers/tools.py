from __future__ import annotations

import logging
import re
import time
from pathlib import Path
from typing import Optional

import aiohttp
from fastapi import APIRouter, Depends, HTTPException, Request, status
from open_webui.config import BYPASS_ADMIN_ACCESS_CONTROL, CACHE_DIR
from open_webui.constants import ERROR_MESSAGES
from open_webui.env import AIOHTTP_CLIENT_SESSION_SSL, AIOHTTP_CLIENT_TIMEOUT, ENABLE_PLUGINS
from open_webui.events import EVENTS, publish_event
from open_webui.internal.db import get_async_session
from open_webui.models.access_grants import AccessGrants
from open_webui.models.config import Config
from open_webui.models.groups import Groups
from open_webui.models.oauth_sessions import OAuthSessions
from open_webui.models.tools import (
    ToolAccessResponse,
    ToolForm,
    ToolModel,
    ToolResponse,
    Tools,
    ToolUserResponse,
)
from open_webui.utils.access_control import (
    filter_allowed_access_grants,
    has_access,
    has_connection_access,
    has_permission,
)
from open_webui.utils.auth import get_admin_user, get_verified_user
from open_webui.utils.plugin import (
    get_tools_cache,
    get_tool_module_from_cache,
    load_tool_module_by_id,
    replace_imports,
    resolve_valves_schema_options,
)
from open_webui.utils.mcp import filesystem as mcp_filesystem
from open_webui.utils.tools import build_tool_server_headers, get_tool_servers, get_tool_specs
from pydantic import BaseModel, HttpUrl
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)


router = APIRouter()


async def get_tool_module(request, tool_id, load_from_db=True):
    """
    Get the tool module by its ID.
    """
    tool_module, _ = await get_tool_module_from_cache(request, tool_id, load_from_db)
    return tool_module


############################
# GetTools
# The danger is not in having tools, but in reaching
# for the wrong one. Let the choice here be deliberate.
############################


@router.get('/', response_model=list[ToolUserResponse])
async def get_tools(
    request: Request,
    query: Optional[str] = None,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    tools = []
    bypass_access_control = user.role == 'admin' and BYPASS_ADMIN_ACCESS_CONTROL
    user_group_ids = (
        set() if bypass_access_control else {group.id for group in await Groups.get_groups_by_member_id(user.id, db=db)}
    )

    # Local Tools
    if ENABLE_PLUGINS:
        tools_cache = get_tools_cache(request)
        for tool in await Tools.get_tools(
            defer_content=True,
            db=db,
            user_id=None if bypass_access_control else user.id,
            user_group_ids=user_group_ids,
        ):
            tool_module = tools_cache.get(tool.id)
            has_user_valves = (
                hasattr(tool_module, 'UserValves')
                if tool_module
                else (tool.meta.has_user_valves if tool.meta else False)
            )
            tools.append(
                ToolUserResponse(
                    **{
                        **tool.model_dump(),
                        'has_user_valves': has_user_valves,
                    }
                )
            )

    # OpenAPI Tool Servers
    server_access_grants = {}
    for server in await get_tool_servers(request):
        server_idx = server.get('idx', 0)
        connections = await Config.get('tool_server.connections', [])
        if server_idx >= len(connections):
            log.warning(
                f'Tool server index {server_idx} out of range '
                f'(have {len(connections)} connections), skipping server {server.get("id")}'
            )
            continue
        connection = connections[server_idx]
        server_config = connection.get('config', {})

        server_id = f'server:{server.get("id")}'
        server_access_grants[server_id] = server_config.get('access_grants', [])

        tools.append(
            ToolUserResponse(
                **{
                    'id': server_id,
                    'user_id': server_id,
                    'name': server.get('openapi', {}).get('info', {}).get('title', 'Tool Server'),
                    'meta': {
                        'description': server.get('openapi', {}).get('info', {}).get('description', ''),
                    },
                    'updated_at': int(time.time()),
                    'created_at': int(time.time()),
                }
            )
        )

    # MCP Tool Servers
    for server in await Config.get('tool_server.connections', []):
        if server.get('type', 'openapi') == 'mcp' and (server.get('config') or {}).get('enable'):
            info = server.get('info') or {}
            server_id = info.get('id')
            auth_type = server.get('auth_type', 'none')

            session_token = None
            if auth_type in ('oauth_2.1', 'oauth_2.1_static') and server_id:
                splits = server_id.split(':')
                server_id = splits[-1] if len(splits) > 1 else server_id

                session_token = await request.app.state.oauth_client_manager.get_oauth_token(
                    user.id, f'mcp:{server_id}'
                )

            server_config = server.get('config') or {}

            tool_id = f'server:mcp:{info.get("id")}'
            server_access_grants[tool_id] = server_config.get('access_grants', [])

            tools.append(
                ToolUserResponse(
                    **{
                        'id': tool_id,
                        'user_id': tool_id,
                        'name': info.get('name', 'MCP Tool Server'),
                        'meta': {
                            'description': info.get('description', ''),
                        },
                        'updated_at': int(time.time()),
                        'created_at': int(time.time()),
                        **(
                            {
                                'authenticated': session_token is not None,
                            }
                            if auth_type in ('oauth_2.1', 'oauth_2.1_static')
                            else {}
                        ),
                    }
                )
            )

    if not bypass_access_control:
        tools = [
            tool
            for tool in tools
            if not str(tool.id).startswith('server:')
            or await has_access(
                user.id,
                'read',
                server_access_grants.get(str(tool.id), []),
                user_group_ids,
                db=db,
            )
        ]

    if query:
        q = query.casefold()
        tools = [tool for tool in tools if q in (tool.name or '').casefold()]

    return tools


############################
# GetToolList
############################


@router.get('/list', response_model=list[ToolAccessResponse])
async def get_tool_list(user=Depends(get_verified_user), db: AsyncSession = Depends(get_async_session)):
    if not ENABLE_PLUGINS:
        return []

    bypass_access_control = user.role == 'admin' and BYPASS_ADMIN_ACCESS_CONTROL
    user_group_ids = (
        set() if bypass_access_control else {group.id for group in await Groups.get_groups_by_member_id(user.id, db=db)}
    )
    tools = await Tools.get_tools(
        defer_content=True,
        db=db,
        user_id=None if bypass_access_control else user.id,
        user_group_ids=user_group_ids,
    )

    result = []
    for tool in tools:
        has_write = (
            bypass_access_control
            or user.id == tool.user_id
            or any(
                g.permission == 'write'
                and (
                    (g.principal_type == 'user' and (g.principal_id == user.id or g.principal_id == '*'))
                    or (g.principal_type == 'group' and g.principal_id in user_group_ids)
                )
                for g in tool.access_grants
            )
        )
        result.append(
            ToolAccessResponse(
                **tool.model_dump(),
                write_access=has_write,
            )
        )
    return result


############################
# LoadFunctionFromLink
############################


class LoadUrlForm(BaseModel):
    url: HttpUrl


def github_url_to_raw_url(url: str) -> str:
    # Handle 'tree' (folder) URLs (add main.py at the end)
    m1 = re.match(r'https://github\.com/([^/]+)/([^/]+)/tree/([^/]+)/(.*)', url)
    if m1:
        org, repo, branch, path = m1.groups()
        return f'https://raw.githubusercontent.com/{org}/{repo}/refs/heads/{branch}/{path.rstrip("/")}/main.py'

    # Handle 'blob' (file) URLs
    m2 = re.match(r'https://github\.com/([^/]+)/([^/]+)/blob/([^/]+)/(.*)', url)
    if m2:
        org, repo, branch, path = m2.groups()
        return f'https://raw.githubusercontent.com/{org}/{repo}/refs/heads/{branch}/{path}'

    # No match; return as-is
    return url


@router.post('/load/url', response_model=dict | None)
async def load_tool_from_url(request: Request, form_data: LoadUrlForm, user=Depends(get_admin_user)):
    # NOTE: This is NOT a SSRF vulnerability:
    # This endpoint is admin-only (see get_admin_user), meant for *trusted* internal use,
    # and does NOT accept untrusted user input. Access is enforced by authentication.

    url = str(form_data.url)
    if not url:
        raise HTTPException(status_code=400, detail='Please enter a valid URL')

    url = github_url_to_raw_url(url)
    url_parts = url.rstrip('/').split('/')

    file_name = url_parts[-1]
    tool_name = (
        file_name[:-3]
        if (file_name.endswith('.py') and (not file_name.startswith(('main.py', 'index.py', '__init__.py'))))
        else url_parts[-2]
        if len(url_parts) > 1
        else 'function'
    )

    try:
        async with aiohttp.ClientSession(
            trust_env=True, timeout=aiohttp.ClientTimeout(total=AIOHTTP_CLIENT_TIMEOUT)
        ) as session:
            async with session.get(
                url, headers={'Content-Type': 'application/json'}, ssl=AIOHTTP_CLIENT_SESSION_SSL
            ) as resp:
                if resp.status != 200:
                    raise HTTPException(status_code=resp.status, detail='Failed to fetch the tool')
                data = await resp.text()
                if not data:
                    raise HTTPException(status_code=400, detail='No data received from the URL')
        return {
            'name': tool_name,
            'content': data,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=ERROR_MESSAGES.DEFAULT(e, 'Error fetching tool'),
        )


############################
# ExportTools
############################


@router.get('/export', response_model=list[ToolModel])
async def export_tools(
    request: Request,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    if user.role != 'admin' and not await has_permission(
        user.id,
        'workspace.tools_export',
        await Config.get('user.permissions'),
        db=db,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ERROR_MESSAGES.UNAUTHORIZED,
        )

    bypass_access_control = user.role == 'admin' and BYPASS_ADMIN_ACCESS_CONTROL
    return await Tools.get_tools(
        db=db,
        user_id=None if bypass_access_control else user.id,
    )


############################
# CreateNewTools
############################


@router.post('/create', response_model=ToolResponse | None)
async def create_new_tools(
    request: Request,
    form_data: ToolForm,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Create a new tool from user-supplied Python source code."""
    if user.role != 'admin' and not (
        await has_permission(user.id, 'workspace.tools', await Config.get('user.permissions'), db=db)
        or await has_permission(
            user.id,
            'workspace.tools_import',
            await Config.get('user.permissions'),
            db=db,
        )
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ERROR_MESSAGES.UNAUTHORIZED,
        )

    if not form_data.id.isidentifier():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Only alphanumeric characters and underscores are allowed in the id',
        )

    form_data.id = form_data.id.lower()

    tools = await Tools.get_tool_by_id(form_data.id, db=db)
    if tools is None:
        try:
            form_data.access_grants = await filter_allowed_access_grants(
                await Config.get('user.permissions'),
                user.id,
                user.role,
                form_data.access_grants,
                'sharing.public_tools',
            )

            form_data.content = replace_imports(form_data.content)
            tool_module, frontmatter = await load_tool_module_by_id(form_data.id, content=form_data.content)
            form_data.meta.manifest = frontmatter
            form_data.meta.has_user_valves = hasattr(tool_module, 'UserValves')

            TOOLS = get_tools_cache(request)
            TOOLS[form_data.id] = tool_module

            specs = get_tool_specs(TOOLS[form_data.id])
            tools = await Tools.insert_new_tool(user.id, form_data, specs, db=db)

            tool_cache_dir = CACHE_DIR / 'tools' / form_data.id
            tool_cache_dir.mkdir(parents=True, exist_ok=True)

            if tools:
                await publish_event(
                    request,
                    EVENTS.TOOL_CREATED,
                    actor=user,
                    subject_id=tools.id,
                    data={'name': tools.name},
                )
                return tools
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=ERROR_MESSAGES.DEFAULT('Error creating tools'),
                )
        except HTTPException:
            raise
        except Exception as e:
            log.exception(f'Failed to load the tool by id {form_data.id}: {e}')
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ERROR_MESSAGES.DEFAULT(e, 'Error creating tool'),
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ERROR_MESSAGES.ID_TAKEN,
        )


############################
# GetToolsById
############################


@router.get('/id/{id}', response_model=ToolAccessResponse | None)
async def get_tools_by_id(id: str, user=Depends(get_verified_user), db: AsyncSession = Depends(get_async_session)):
    tools = await Tools.get_tool_by_id(id, db=db)

    if tools:
        if (
            user.role == 'admin'
            or tools.user_id == user.id
            or await AccessGrants.has_access(
                user_id=user.id,
                resource_type='tool',
                resource_id=tools.id,
                permission='read',
                db=db,
            )
        ):
            write_access = (
                (user.role == 'admin' and BYPASS_ADMIN_ACCESS_CONTROL)
                or user.id == tools.user_id
                or await AccessGrants.has_access(
                    user_id=user.id,
                    resource_type='tool',
                    resource_id=tools.id,
                    permission='write',
                    db=db,
                )
            )
            data = tools.model_dump()
            if not write_access:
                # extra='allow' re-admits content from model_dump; source is writer-only
                data.pop('content', None)
            return ToolAccessResponse(**data, write_access=write_access)
        else:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=ERROR_MESSAGES.ACCESS_PROHIBITED,
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.NOT_FOUND,
        )


############################
# UpdateToolsById
############################


@router.post('/id/{id}/update', response_model=ToolModel | None)
async def update_tools_by_id(
    request: Request,
    id: str,
    form_data: ToolForm,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Update an existing tool's source code and metadata."""
    tools = await Tools.get_tool_by_id(id, db=db)
    if not tools:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ERROR_MESSAGES.NOT_FOUND,
        )

    # Is the user the original creator, in a group with write access, or an admin
    if (
        tools.user_id != user.id
        and not await AccessGrants.has_access(
            user_id=user.id,
            resource_type='tool',
            resource_id=tools.id,
            permission='write',
            db=db,
        )
        and user.role != 'admin'
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ERROR_MESSAGES.UNAUTHORIZED,
        )

    # Content edits trigger exec on load — gate them behind workspace.tools (matches /create).
    if form_data.content != tools.content:
        if user.role != 'admin' and not (
            await has_permission(user.id, 'workspace.tools', await Config.get('user.permissions'), db=db)
            or await has_permission(user.id, 'workspace.tools_import', await Config.get('user.permissions'), db=db)
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=ERROR_MESSAGES.UNAUTHORIZED,
            )

    try:
        form_data.content = replace_imports(form_data.content)
        tool_module, frontmatter = await load_tool_module_by_id(id, content=form_data.content)
        form_data.meta.manifest = frontmatter
        form_data.meta.has_user_valves = hasattr(tool_module, 'UserValves')

        TOOLS = get_tools_cache(request)
        TOOLS[id] = tool_module

        specs = get_tool_specs(TOOLS[id])

        form_data.access_grants = await filter_allowed_access_grants(
            await Config.get('user.permissions'),
            user.id,
            user.role,
            form_data.access_grants,
            'sharing.public_tools',
        )

        updated = {
            **form_data.model_dump(exclude={'id'}),
            'specs': specs,
        }

        log.debug(updated)
        tools = await Tools.update_tool_by_id(id, updated, db=db)

        if tools:
            await publish_event(
                request,
                EVENTS.TOOL_UPDATED,
                actor=user,
                subject_id=tools.id,
                data={'name': tools.name},
            )
            return tools
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ERROR_MESSAGES.DEFAULT('Error updating tools'),
            )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ERROR_MESSAGES.DEFAULT(e, 'Error updating tool'),
        )


############################
# UpdateToolAccessById
############################


class ToolAccessGrantsForm(BaseModel):
    access_grants: list[dict]


@router.post('/id/{id}/access/update', response_model=ToolModel | None)
async def update_tool_access_by_id(
    request: Request,
    id: str,
    form_data: ToolAccessGrantsForm,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    tools = await Tools.get_tool_by_id(id, db=db)
    if not tools:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.NOT_FOUND,
        )

    if (
        tools.user_id != user.id
        and not await AccessGrants.has_access(
            user_id=user.id,
            resource_type='tool',
            resource_id=tools.id,
            permission='write',
            db=db,
        )
        and user.role != 'admin'
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ERROR_MESSAGES.UNAUTHORIZED,
        )

    form_data.access_grants = await filter_allowed_access_grants(
        await Config.get('user.permissions'),
        user.id,
        user.role,
        form_data.access_grants,
        'sharing.public_tools',
    )

    await AccessGrants.set_access_grants('tool', id, form_data.access_grants, db=db)

    tools = await Tools.get_tool_by_id(id, db=db)
    await publish_event(
        request,
        EVENTS.TOOL_ACCESS_UPDATED,
        actor=user,
        subject_id=id,
        data={'name': tools.name if tools else None},
    )
    return tools


############################
# DeleteToolsById
############################


@router.delete('/id/{id}/delete', response_model=bool)
async def delete_tools_by_id(
    request: Request,
    id: str,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    tools = await Tools.get_tool_by_id(id, db=db)
    if not tools:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ERROR_MESSAGES.NOT_FOUND,
        )

    if (
        tools.user_id != user.id
        and not await AccessGrants.has_access(
            user_id=user.id,
            resource_type='tool',
            resource_id=tools.id,
            permission='write',
            db=db,
        )
        and user.role != 'admin'
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ERROR_MESSAGES.UNAUTHORIZED,
        )

    result = await Tools.delete_tool_by_id(id, db=db)
    if result:
        TOOLS = get_tools_cache(request)
        TOOLS.pop(id, None)
        await publish_event(
            request,
            EVENTS.TOOL_DELETED,
            actor=user,
            subject_id=id,
            data={'name': tools.name},
        )

    return result


############################
# GetToolValves
############################


@router.get('/id/{id}/valves', response_model=dict | None)
async def get_tools_valves_by_id(
    id: str, user=Depends(get_verified_user), db: AsyncSession = Depends(get_async_session)
):
    tools = await Tools.get_tool_by_id(id, db=db)
    if not tools:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.NOT_FOUND,
        )

    if (
        tools.user_id != user.id
        and not await AccessGrants.has_access(
            user_id=user.id,
            resource_type='tool',
            resource_id=tools.id,
            permission='write',
            db=db,
        )
        and user.role != 'admin'
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ERROR_MESSAGES.ACCESS_PROHIBITED,
        )

    try:
        valves = await Tools.get_tool_valves_by_id(id, db=db)
        return valves
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ERROR_MESSAGES.DEFAULT(e, 'Error getting tool valves'),
        )


############################
# GetToolValvesSpec
############################


@router.get('/id/{id}/valves/spec', response_model=dict | None)
async def get_tools_valves_spec_by_id(
    request: Request,
    id: str,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    tools = await Tools.get_tool_by_id(id, db=db)
    if not tools:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.NOT_FOUND,
        )

    if (
        tools.user_id != user.id
        and not await AccessGrants.has_access(
            user_id=user.id,
            resource_type='tool',
            resource_id=tools.id,
            permission='write',
            db=db,
        )
        and user.role != 'admin'
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ERROR_MESSAGES.ACCESS_PROHIBITED,
        )

    tools_module, _ = await get_tool_module_from_cache(request, id)

    if hasattr(tools_module, 'Valves'):
        Valves = tools_module.Valves
        schema = Valves.schema()
        # Resolve dynamic options for select dropdowns
        schema = resolve_valves_schema_options(Valves, schema, user)
        return schema
    return None


############################
# UpdateToolValves
############################


@router.post('/id/{id}/valves/update', response_model=dict | None)
async def update_tools_valves_by_id(
    request: Request,
    id: str,
    form_data: dict,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    tools = await Tools.get_tool_by_id(id, db=db)
    if not tools:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ERROR_MESSAGES.NOT_FOUND,
        )

    if (
        tools.user_id != user.id
        and not await AccessGrants.has_access(
            user_id=user.id,
            resource_type='tool',
            resource_id=tools.id,
            permission='write',
            db=db,
        )
        and user.role != 'admin'
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ERROR_MESSAGES.ACCESS_PROHIBITED,
        )

    tools_module, _ = await get_tool_module_from_cache(request, id)

    if not hasattr(tools_module, 'Valves'):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ERROR_MESSAGES.NOT_FOUND,
        )
    Valves = tools_module.Valves

    try:
        form_data = {k: v for k, v in form_data.items() if v is not None}
        valves = Valves(**form_data)
        valves_dict = valves.model_dump(exclude_unset=True)
        await Tools.update_tool_valves_by_id(id, valves_dict, db=db)
        await publish_event(
            request,
            EVENTS.TOOL_VALVES_UPDATED,
            actor=user,
            subject_id=id,
        )
        return valves_dict
    except Exception as e:
        log.exception(f'Failed to update tool valves by id {id}: {e}')
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ERROR_MESSAGES.DEFAULT(e, 'Error updating tool valves'),
        )


############################
# ToolUserValves
############################


@router.get('/id/{id}/valves/user', response_model=dict | None)
async def get_tools_user_valves_by_id(
    id: str, user=Depends(get_verified_user), db: AsyncSession = Depends(get_async_session)
):
    tools = await Tools.get_tool_by_id(id, db=db)
    if not tools:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.NOT_FOUND,
        )

    if (
        tools.user_id != user.id
        and not await AccessGrants.has_access(
            user_id=user.id,
            resource_type='tool',
            resource_id=tools.id,
            permission='read',
            db=db,
        )
        and user.role != 'admin'
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ERROR_MESSAGES.ACCESS_PROHIBITED,
        )

    try:
        user_valves = await Tools.get_user_valves_by_id_and_user_id(id, user.id, db=db)
        return user_valves
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ERROR_MESSAGES.DEFAULT(e, 'Error getting tool user valves'),
        )


@router.get('/id/{id}/valves/user/spec', response_model=dict | None)
async def get_tools_user_valves_spec_by_id(
    request: Request,
    id: str,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    tools = await Tools.get_tool_by_id(id, db=db)
    if not tools:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.NOT_FOUND,
        )

    if (
        tools.user_id != user.id
        and not await AccessGrants.has_access(
            user_id=user.id,
            resource_type='tool',
            resource_id=tools.id,
            permission='read',
            db=db,
        )
        and user.role != 'admin'
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ERROR_MESSAGES.ACCESS_PROHIBITED,
        )

    tools_module, _ = await get_tool_module_from_cache(request, id)

    if hasattr(tools_module, 'UserValves'):
        UserValves = tools_module.UserValves
        schema = UserValves.schema()
        # Resolve dynamic options for select dropdowns
        schema = resolve_valves_schema_options(UserValves, schema, user)
        return schema
    return None


@router.post('/id/{id}/valves/user/update', response_model=dict | None)
async def update_tools_user_valves_by_id(
    request: Request,
    id: str,
    form_data: dict,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    tools = await Tools.get_tool_by_id(id, db=db)
    if not tools:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.NOT_FOUND,
        )

    if (
        tools.user_id != user.id
        and not await AccessGrants.has_access(
            user_id=user.id,
            resource_type='tool',
            resource_id=tools.id,
            permission='read',
            db=db,
        )
        and user.role != 'admin'
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ERROR_MESSAGES.ACCESS_PROHIBITED,
        )

    tools_module, _ = await get_tool_module_from_cache(request, id)

    if hasattr(tools_module, 'UserValves'):
        UserValves = tools_module.UserValves

        try:
            form_data = {k: v for k, v in form_data.items() if v is not None}
            user_valves = UserValves(**form_data)
            user_valves_dict = user_valves.model_dump(exclude_unset=True)
            await Tools.update_user_valves_by_id_and_user_id(id, user.id, user_valves_dict, db=db)
            await publish_event(
                request,
                EVENTS.TOOL_VALVES_UPDATED,
                actor=user,
                subject_id=id,
                data={'scope': 'user'},
            )
            return user_valves_dict
        except Exception as e:
            log.exception(f'Failed to update user valves by id {id}: {e}')
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ERROR_MESSAGES.DEFAULT(e, 'Error updating tool user valves'),
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ERROR_MESSAGES.NOT_FOUND,
        )


############################
# Browsing a filesystem MCP server
############################


class MCPFilesystemServer(BaseModel):
    id: str
    name: str
    #: The directories the server is willing to show, when it says.
    roots: list[str]
    #: Which of the read operations this particular server can serve.
    operations: list[str]


class MCPFilesystemForm(BaseModel):
    operation: str
    path: str | None = None
    pattern: str | None = None


async def _mcp_filesystem_connection(request: Request, user, server_id: str) -> tuple[dict, dict, list[dict]]:
    """Resolve a server the user is allowed to browse.

    Returns the connection, the headers to reach it with, and its tool list.
    """
    connection = mcp_filesystem.find_connection(await Config.get('tool_server.connections', []), server_id)
    if not connection:
        raise HTTPException(status_code=404, detail=ERROR_MESSAGES.NOT_FOUND)

    if not await has_connection_access(user, connection):
        raise HTTPException(status_code=401, detail=ERROR_MESSAGES.ACCESS_PROHIBITED)

    headers, _ = await build_tool_server_headers(connection, request, user, server_id=server_id)
    specs = await mcp_filesystem.fetch_specs(connection.get('url', ''), headers or None, (server_id, str(user.id)))
    return connection, headers, specs


@router.get('/mcp/filesystem/servers', response_model=list[MCPFilesystemServer])
async def get_mcp_filesystem_servers(request: Request, user=Depends(get_verified_user)):
    """The MCP servers this user may browse a filesystem on.

    Every enabled MCP server is asked what tools it has, and the ones that can
    list a directory are offered. A server that cannot be reached is left out
    rather than failing the whole list: one unreachable connection should not
    take the file browser away from the others.
    """
    servers = []

    for connection in mcp_filesystem.mcp_connections(await Config.get('tool_server.connections', [])):
        info = connection.get('info') or {}
        server_id = info.get('id')
        if not server_id or not await has_connection_access(user, connection):
            continue

        try:
            headers, _ = await build_tool_server_headers(connection, request, user, server_id=server_id)
            specs = await mcp_filesystem.fetch_specs(
                connection.get('url', ''), headers or None, (server_id, str(user.id))
            )
        except Exception as e:
            log.debug('Could not read tools from MCP server %s: %s', server_id, e)
            continue

        if not mcp_filesystem.is_filesystem_server(specs):
            continue

        tools = mcp_filesystem.resolve_tools(specs)

        roots = []
        if 'roots' in tools:
            try:
                result = await mcp_filesystem.call(connection.get('url', ''), headers or None, tools['roots'], {})
                roots = mcp_filesystem.parse_allowed_directories(result.get('content'), result.get('structuredContent'))
            except Exception as e:
                # A server that will not say where its roots are can still be
                # browsed; the caller asks for a path instead.
                log.debug('Could not read roots from MCP server %s: %s', server_id, e)

        servers.append(
            MCPFilesystemServer(
                id=server_id,
                name=info.get('name') or 'MCP Server',
                roots=roots,
                operations=sorted(tools.keys()),
            )
        )

    return servers


@router.post('/mcp/filesystem/{server_id}')
async def call_mcp_filesystem(
    request: Request,
    server_id: str,
    form_data: MCPFilesystemForm,
    user=Depends(get_verified_user),
):
    """Run one read operation against a filesystem MCP server.

    The operation names are a closed set that maps only onto tools which cannot
    change anything. A server offering `write_file` or `move_file` has them
    reachable from a chat, where the user approves each call -- never from here.
    """
    connection, headers, specs = await _mcp_filesystem_connection(request, user, server_id)
    tools = mcp_filesystem.resolve_tools(specs)

    tool_name = tools.get(form_data.operation)
    if not tool_name:
        raise HTTPException(status_code=400, detail=f"This server cannot '{form_data.operation}'.")

    arguments: dict = {}
    if form_data.operation in ('list', 'tree', 'read', 'info', 'search'):
        if not form_data.path:
            raise HTTPException(status_code=400, detail='A path is required.')
        arguments['path'] = form_data.path
    if form_data.operation == 'search':
        arguments['pattern'] = form_data.pattern or ''

    try:
        result = await mcp_filesystem.call(connection.get('url', ''), headers or None, tool_name, arguments)
    except Exception as e:
        # The reason is what makes this fixable: a path outside the allowed
        # roots and a server that is down look identical without it.
        log.debug('MCP filesystem %s failed on %s: %s', form_data.operation, server_id, e)
        raise HTTPException(status_code=400, detail=str(e)) from e

    content = result.get('content')
    structured = result.get('structuredContent')

    if form_data.operation == 'list':
        return {'operation': 'list', 'tool': tool_name, **mcp_filesystem.parse_directory_listing(content, structured)}
    if form_data.operation == 'roots':
        return {
            'operation': 'roots',
            'tool': tool_name,
            'roots': mcp_filesystem.parse_allowed_directories(content, structured),
        }
    if form_data.operation == 'info':
        return {'operation': 'info', 'tool': tool_name, 'info': mcp_filesystem.parse_file_info(content, structured)}

    return {
        'operation': form_data.operation,
        'tool': tool_name,
        'text': mcp_filesystem.result_text(content),
        'structured': structured,
    }
