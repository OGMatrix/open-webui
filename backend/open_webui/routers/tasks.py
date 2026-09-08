import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse
from open_webui.config import (
    DEFAULT_AUTOCOMPLETE_GENERATION_PROMPT_TEMPLATE,
    DEFAULT_TOOL_SUGGESTIONS_PROMPT_TEMPLATE,
    DEFAULT_EMOJI_GENERATION_PROMPT_TEMPLATE,
    DEFAULT_FOLLOW_UP_GENERATION_PROMPT_TEMPLATE,
    DEFAULT_IMAGE_PROMPT_GENERATION_PROMPT_TEMPLATE,
    DEFAULT_MOA_GENERATION_PROMPT_TEMPLATE,
    DEFAULT_QUERY_GENERATION_PROMPT_TEMPLATE,
    DEFAULT_TAGS_GENERATION_PROMPT_TEMPLATE,
    DEFAULT_TITLE_GENERATION_PROMPT_TEMPLATE,
    DEFAULT_VOICE_MODE_PROMPT_TEMPLATE,
)
from open_webui.constants import ERROR_MESSAGES, TASKS
from open_webui.models.config import Config
from open_webui.routers.pipelines import process_pipeline_inlet_filter
from open_webui.routers.skills import get_skills
from open_webui.routers.tools import get_tools
from open_webui.utils.access_control import has_permission
from open_webui.utils.auth import get_admin_user, get_verified_user
from open_webui.utils.chat import generate_chat_completion
from open_webui.utils.payload import apply_params_to_form_data
from sqlalchemy.ext.asyncio import AsyncSession
from open_webui.internal.db import get_async_session
from open_webui.utils.task import (
    autocomplete_generation_template,
    emoji_generation_template,
    follow_up_generation_template,
    get_task_model_id,
    image_prompt_generation_template,
    moa_response_generation_template,
    query_generation_template,
    tags_generation_template,
    title_generation_template,
    tool_suggestions_generation_template,
)
from pydantic import BaseModel

log = logging.getLogger(__name__)

router = APIRouter()

TASK_CONFIG_KEYS = {
    'TASK_MODEL': 'task.model.default',
    'TASK_MODEL_EXTERNAL': 'task.model.external',
    'TASK_MODEL_PARAMS': 'task.model.params',
    'TITLE_GENERATION_PROMPT_TEMPLATE': 'task.title.prompt_template',
    'IMAGE_PROMPT_GENERATION_PROMPT_TEMPLATE': 'task.image.prompt_template',
    'ENABLE_AUTOCOMPLETE_GENERATION': 'task.autocomplete.enable',
    'AUTOCOMPLETE_GENERATION_INPUT_MAX_LENGTH': 'task.autocomplete.input_max_length',
    'AUTOCOMPLETE_GENERATION_PROMPT_TEMPLATE': 'task.autocomplete.prompt_template',
    'TAGS_GENERATION_PROMPT_TEMPLATE': 'task.tags.prompt_template',
    'FOLLOW_UP_GENERATION_PROMPT_TEMPLATE': 'task.follow_up.prompt_template',
    'ENABLE_FOLLOW_UP_GENERATION': 'task.follow_up.enable',
    'TOOL_SUGGESTIONS_PROMPT_TEMPLATE': 'task.tool_suggestions.prompt_template',
    'ENABLE_TOOL_SUGGESTIONS': 'task.tool_suggestions.enable',
    'ENABLE_TAGS_GENERATION': 'task.tags.enable',
    'ENABLE_TITLE_GENERATION': 'task.title.enable',
    'ENABLE_SEARCH_QUERY_GENERATION': 'task.query.search.enable',
    'ENABLE_RETRIEVAL_QUERY_GENERATION': 'task.query.retrieval.enable',
    'QUERY_GENERATION_PROMPT_TEMPLATE': 'task.query.prompt_template',
    'TOOLS_FUNCTION_CALLING_PROMPT_TEMPLATE': 'task.tools.prompt_template',
    'ENABLE_VOICE_MODE_PROMPT': 'task.voice.prompt.enable',
    'VOICE_MODE_PROMPT_TEMPLATE': 'task.voice.prompt_template',
}


async def get_config_values(key_map: dict[str, str]) -> dict:
    values = await Config.get_many(*key_map.values())
    return {field: values[storage_key] for field, storage_key in key_map.items() if storage_key in values}


def config_updates(data: dict, key_map: dict[str, str]) -> dict:
    return {key_map[field]: value for field, value in data.items() if field in key_map}


def apply_task_model_params(payload: dict, models: dict, task_model_id: str, params: dict | None = None) -> dict:
    model = models.get(payload.get('model')) or models.get(task_model_id)
    if not model or (not params and not payload.get('params')):
        return payload
    return apply_params_to_form_data(payload, model, params or None)


async def get_task_model_generation_config(default_model_id: str, models) -> tuple[str, dict]:
    config = await Config.get_many(
        'task.model.default',
        'task.model.external',
        'task.model.params',
    )
    params = config.get('task.model.params') or {}
    if not isinstance(params, dict):
        params = {}

    return (
        get_task_model_id(
            default_model_id,
            config.get('task.model.default'),
            config.get('task.model.external'),
            models,
        ),
        {key: value for key, value in params.items() if value is not None and value != ''},
    )


##################################
#
# Task Endpoints
#
##################################


@router.get('/config')
async def get_task_config(request: Request, user=Depends(get_verified_user)):
    return await get_config_values(TASK_CONFIG_KEYS)


class TaskConfigForm(BaseModel):
    TASK_MODEL: Optional[str]
    TASK_MODEL_EXTERNAL: Optional[str]
    TASK_MODEL_PARAMS: dict | None = None
    ENABLE_TITLE_GENERATION: bool
    TITLE_GENERATION_PROMPT_TEMPLATE: str
    IMAGE_PROMPT_GENERATION_PROMPT_TEMPLATE: str
    ENABLE_AUTOCOMPLETE_GENERATION: bool
    AUTOCOMPLETE_GENERATION_INPUT_MAX_LENGTH: int
    AUTOCOMPLETE_GENERATION_PROMPT_TEMPLATE: str
    TAGS_GENERATION_PROMPT_TEMPLATE: str
    FOLLOW_UP_GENERATION_PROMPT_TEMPLATE: str
    ENABLE_FOLLOW_UP_GENERATION: bool
    TOOL_SUGGESTIONS_PROMPT_TEMPLATE: str = ''
    ENABLE_TOOL_SUGGESTIONS: bool = True
    ENABLE_TAGS_GENERATION: bool
    ENABLE_SEARCH_QUERY_GENERATION: bool
    ENABLE_RETRIEVAL_QUERY_GENERATION: bool
    QUERY_GENERATION_PROMPT_TEMPLATE: str
    TOOLS_FUNCTION_CALLING_PROMPT_TEMPLATE: str
    ENABLE_VOICE_MODE_PROMPT: bool
    VOICE_MODE_PROMPT_TEMPLATE: Optional[str]


@router.post('/config/update')
async def update_task_config(request: Request, form_data: TaskConfigForm, user=Depends(get_admin_user)):
    await Config.upsert(config_updates(form_data.model_dump(), TASK_CONFIG_KEYS))
    return await get_config_values(TASK_CONFIG_KEYS)


@router.post('/title/completions')
async def generate_title(request: Request, form_data: dict, user=Depends(get_verified_user)):
    if not await Config.get('task.title.enable'):
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={'detail': 'Title generation is disabled'},
        )

    if getattr(request.state, 'direct', False) and hasattr(request.state, 'model'):
        models = {
            **dict(request.app.state.MODELS.items()),
            request.state.model['id']: request.state.model,
        }
    else:
        models = request.app.state.MODELS

    model_id = form_data['model']
    if not model_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='No model specified for title generation. Please ensure a model is selected for this chat.',
        )
    if model_id not in models:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.MODEL_NOT_FOUND(),
        )

    task_model_id, task_model_params = await get_task_model_generation_config(model_id, models)

    log.debug('generating chat title using model %s for user %s ', task_model_id, user.email)

    title_template = await Config.get('task.title.prompt_template')
    if title_template != '':
        template = title_template
    else:
        template = DEFAULT_TITLE_GENERATION_PROMPT_TEMPLATE

    content = await title_generation_template(template, form_data['messages'], user)
    task_model_params = task_model_params or {
        'max_tokens': models[task_model_id].get('info', {}).get('params', {}).get('max_tokens', 1000)
    }

    payload = {
        'model': task_model_id,
        'messages': [{'role': 'user', 'content': content}],
        'stream': False,
        'metadata': {
            **(request.state.metadata if hasattr(request.state, 'metadata') else {}),
            'task': str(TASKS.TITLE_GENERATION),
            'task_body': form_data,
            'chat_id': form_data.get('chat_id', None),
        },
    }

    # Process the payload through the pipeline
    try:
        payload = await process_pipeline_inlet_filter(request, payload, user, models)
    except Exception as e:
        raise e

    payload = apply_task_model_params(payload, models, task_model_id, task_model_params)

    try:
        return await generate_chat_completion(request, form_data=payload, user=user)
    except Exception as e:
        log.error('Exception occurred', exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={'detail': 'An internal error has occurred.'},
        )


@router.post('/follow_up/completions')
async def generate_follow_ups(request: Request, form_data: dict, user=Depends(get_verified_user)):
    if not await Config.get('task.follow_up.enable'):
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={'detail': 'Follow-up generation is disabled'},
        )

    if getattr(request.state, 'direct', False) and hasattr(request.state, 'model'):
        models = {
            **dict(request.app.state.MODELS.items()),
            request.state.model['id']: request.state.model,
        }
    else:
        models = request.app.state.MODELS

    model_id = form_data['model']
    if model_id not in models:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.MODEL_NOT_FOUND(),
        )

    task_model_id, task_model_params = await get_task_model_generation_config(model_id, models)

    log.debug('generating chat title using model %s for user %s ', task_model_id, user.email)

    follow_up_template = await Config.get('task.follow_up.prompt_template')
    if follow_up_template != '':
        template = follow_up_template
    else:
        template = DEFAULT_FOLLOW_UP_GENERATION_PROMPT_TEMPLATE

    content = await follow_up_generation_template(template, form_data['messages'], user)

    payload = {
        'model': task_model_id,
        'messages': [{'role': 'user', 'content': content}],
        'stream': False,
        'metadata': {
            **(request.state.metadata if hasattr(request.state, 'metadata') else {}),
            'task': str(TASKS.FOLLOW_UP_GENERATION),
            'task_body': form_data,
            'chat_id': form_data.get('chat_id', None),
        },
    }

    # Process the payload through the pipeline
    try:
        payload = await process_pipeline_inlet_filter(request, payload, user, models)
    except Exception as e:
        raise e

    payload = apply_task_model_params(payload, models, task_model_id, task_model_params)

    try:
        return await generate_chat_completion(request, form_data=payload, user=user)
    except Exception as e:
        log.error('Exception occurred', exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={'detail': 'An internal error has occurred.'},
        )


# What a message can ask for beyond the tools themselves. The ids carry a prefix
# so a tool of the same name cannot be mistaken for one of them.
SUGGESTABLE_FEATURES = [
    {
        'id': 'feature:web_search',
        'name': 'Web Search',
        'description': 'Searches the internet for information the assistant does not already have.',
        'capability': 'web_search',
        'permission': 'features.web_search',
        'config': 'web.search.enable',
    },
    {
        'id': 'feature:image_generation',
        'name': 'Image Generation',
        'description': 'Draws an image from a description.',
        'capability': 'image_generation',
        'permission': 'features.image_generation',
        'config': 'image_generation.enable',
    },
    {
        'id': 'feature:code_interpreter',
        'name': 'Code Interpreter',
        'description': 'Runs code to compute, transform data, or check a result.',
        'capability': 'code_interpreter',
        'permission': 'features.code_interpreter',
        'config': 'code_interpreter.enable',
    },
]

# A catalogue longer than this stops being something a small model reads and
# starts being something it skims, and the round trip is in front of a person
# waiting to send a message.
MAX_SUGGESTION_CANDIDATES = 120
MAX_SUGGESTION_DESCRIPTION = 300


def _shorten(text: Optional[str]) -> str:
    text = ' '.join((text or '').split())
    if len(text) <= MAX_SUGGESTION_DESCRIPTION:
        return text
    return text[: MAX_SUGGESTION_DESCRIPTION - 1].rstrip() + '\u2026'


async def _suggestable_features(request: Request, user, model: dict) -> list[dict]:
    """The modes this reader could switch on by hand, and nothing else.

    Recommending something the composer will not even show a button for would
    be advice nobody can take, so each mode is gated exactly as its button is:
    enabled on this server, permitted for this reader, and not refused by the
    model. A model that declares nothing counts as capable, which is the rule
    the composer itself uses.
    """
    capabilities = ((model or {}).get('info') or {}).get('meta', {}).get('capabilities') or {}
    permissions = await Config.get('user.permissions')

    available = []
    for feature in SUGGESTABLE_FEATURES:
        if capabilities.get(feature['capability'], True) is False:
            continue
        if not await Config.get(feature['config']):
            continue
        if user.role != 'admin' and not await has_permission(user.id, feature['permission'], permissions):
            continue

        available.append(
            {
                'id': feature['id'],
                'kind': 'feature',
                'name': feature['name'],
                'description': feature['description'],
            }
        )

    return available


async def _suggestion_catalogue(request: Request, user, db, model: dict) -> list[dict]:
    """Everything this reader could switch on for this message.

    Built here rather than taken from the client: the client may only send which
    ids it has switched on, and every id in the answer is checked against this.
    """
    catalogue = []

    for tool in await get_tools(request=request, user=user, db=db):
        # An integration the reader has not signed in to cannot be switched on by
        # recommending it; it needs them to go through OAuth first.
        if getattr(tool, 'authenticated', None) is False:
            continue

        meta = tool.meta.model_dump() if hasattr(tool.meta, 'model_dump') else (tool.meta or {})
        catalogue.append(
            {
                'id': tool.id,
                'kind': 'tool',
                'name': tool.name,
                'description': _shorten((meta or {}).get('description')),
            }
        )

    for skill in await get_skills(request=request, user=user, db=db):
        if not getattr(skill, 'is_active', True):
            continue
        catalogue.append(
            {
                'id': skill.id,
                'kind': 'skill',
                'name': skill.name,
                'description': _shorten(getattr(skill, 'description', None)),
            }
        )

    catalogue.extend(await _suggestable_features(request, user, model))
    return catalogue[:MAX_SUGGESTION_CANDIDATES]


@router.post('/tool_suggestions/completions')
async def generate_tool_suggestions(
    request: Request,
    form_data: dict,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Ask the task model whether this message has what it needs switched on.

    Returns the catalogue alongside the completion, so the caller checks every
    id the model named against the same list the model was given rather than
    against whatever it happens to have loaded.
    """
    if not await Config.get('task.tool_suggestions.enable'):
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={'detail': 'Tool suggestions are disabled', 'candidates': []},
        )

    if getattr(request.state, 'direct', False) and hasattr(request.state, 'model'):
        models = {
            **dict(request.app.state.MODELS.items()),
            request.state.model['id']: request.state.model,
        }
    else:
        models = request.app.state.MODELS

    model_id = form_data['model']
    if model_id not in models:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.MODEL_NOT_FOUND(),
        )

    catalogue = await _suggestion_catalogue(request, user, db, models.get(model_id) or {})
    if not catalogue:
        # Nothing to recommend, so nothing worth a round trip.
        return JSONResponse(status_code=status.HTTP_200_OK, content={'candidates': []})

    known = {candidate['id'] for candidate in catalogue}
    selected_ids = [
        integration_id
        for integration_id in (form_data.get('selected_ids') or [])
        if isinstance(integration_id, str) and integration_id in known
    ]

    task_model_id, task_model_params = await get_task_model_generation_config(model_id, models)

    log.debug('generating tool suggestions using model %s for user %s', task_model_id, user.email)

    tool_suggestions_template = await Config.get('task.tool_suggestions.prompt_template')
    if tool_suggestions_template != '':
        template = tool_suggestions_template
    else:
        template = DEFAULT_TOOL_SUGGESTIONS_PROMPT_TEMPLATE

    content = await tool_suggestions_generation_template(
        template,
        form_data['messages'],
        catalogue,
        selected_ids,
        user,
    )

    payload = {
        'model': task_model_id,
        'messages': [{'role': 'user', 'content': content}],
        'stream': False,
        'metadata': {
            **(request.state.metadata if hasattr(request.state, 'metadata') else {}),
            'task': str(TASKS.TOOL_SUGGESTIONS),
            'task_body': form_data,
            'chat_id': form_data.get('chat_id', None),
        },
    }

    try:
        payload = await process_pipeline_inlet_filter(request, payload, user, models)
    except Exception as e:
        raise e

    payload = apply_task_model_params(payload, models, task_model_id, task_model_params)

    try:
        completion = await generate_chat_completion(request, form_data=payload, user=user)
    except Exception:
        log.error('Exception occurred', exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={'detail': 'An internal error has occurred.'},
        )

    # The caller needs both halves: what was said, and what it may be said about.
    if isinstance(completion, dict):
        return {**completion, 'candidates': catalogue}
    return completion


@router.post('/tags/completions')
async def generate_chat_tags(request: Request, form_data: dict, user=Depends(get_verified_user)):
    if not await Config.get('task.tags.enable'):
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={'detail': 'Tags generation is disabled'},
        )

    if getattr(request.state, 'direct', False) and hasattr(request.state, 'model'):
        models = {
            **dict(request.app.state.MODELS.items()),
            request.state.model['id']: request.state.model,
        }
    else:
        models = request.app.state.MODELS

    model_id = form_data['model']
    if model_id not in models:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.MODEL_NOT_FOUND(),
        )

    task_model_id, task_model_params = await get_task_model_generation_config(model_id, models)

    log.debug('generating chat tags using model %s for user %s ', task_model_id, user.email)

    tags_template = await Config.get('task.tags.prompt_template')
    if tags_template != '':
        template = tags_template
    else:
        template = DEFAULT_TAGS_GENERATION_PROMPT_TEMPLATE

    content = await tags_generation_template(template, form_data['messages'], user)

    payload = {
        'model': task_model_id,
        'messages': [{'role': 'user', 'content': content}],
        'stream': False,
        'metadata': {
            **(request.state.metadata if hasattr(request.state, 'metadata') else {}),
            'task': str(TASKS.TAGS_GENERATION),
            'task_body': form_data,
            'chat_id': form_data.get('chat_id', None),
        },
    }

    # Process the payload through the pipeline
    try:
        payload = await process_pipeline_inlet_filter(request, payload, user, models)
    except Exception as e:
        raise e

    payload = apply_task_model_params(payload, models, task_model_id, task_model_params)

    try:
        return await generate_chat_completion(request, form_data=payload, user=user)
    except Exception as e:
        log.error(f'Error generating chat completion: {e}')
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={'detail': 'An internal error has occurred.'},
        )


@router.post('/image_prompt/completions')
async def generate_image_prompt(request: Request, form_data: dict, user=Depends(get_verified_user)):
    if getattr(request.state, 'direct', False) and hasattr(request.state, 'model'):
        models = {
            **dict(request.app.state.MODELS.items()),
            request.state.model['id']: request.state.model,
        }
    else:
        models = request.app.state.MODELS

    model_id = form_data['model']
    if model_id not in models:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.MODEL_NOT_FOUND(),
        )

    task_model_id, task_model_params = await get_task_model_generation_config(model_id, models)

    log.debug('generating image prompt using model %s for user %s ', task_model_id, user.email)

    image_prompt_template = await Config.get('task.image.prompt_template')
    if image_prompt_template != '':
        template = image_prompt_template
    else:
        template = DEFAULT_IMAGE_PROMPT_GENERATION_PROMPT_TEMPLATE

    content = await image_prompt_generation_template(template, form_data['messages'], user)

    payload = {
        'model': task_model_id,
        'messages': [{'role': 'user', 'content': content}],
        'stream': False,
        'metadata': {
            **(request.state.metadata if hasattr(request.state, 'metadata') else {}),
            'task': str(TASKS.IMAGE_PROMPT_GENERATION),
            'task_body': form_data,
            'chat_id': form_data.get('chat_id', None),
        },
    }

    # Process the payload through the pipeline
    try:
        payload = await process_pipeline_inlet_filter(request, payload, user, models)
    except Exception as e:
        raise e

    payload = apply_task_model_params(payload, models, task_model_id, task_model_params)

    try:
        return await generate_chat_completion(request, form_data=payload, user=user)
    except Exception as e:
        log.error('Exception occurred', exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={'detail': 'An internal error has occurred.'},
        )


@router.post('/queries/completions')
async def generate_queries(request: Request, form_data: dict, user=Depends(get_verified_user)):
    type = form_data.get('type')
    if type == 'web_search':
        if not await Config.get('task.query.search.enable'):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ERROR_MESSAGES.FEATURE_DISABLED('Search query generation'),
            )
    elif type == 'retrieval':
        if not await Config.get('task.query.retrieval.enable'):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ERROR_MESSAGES.FEATURE_DISABLED('Query generation'),
            )

    if getattr(request.state, 'cached_queries', None):
        log.info('Reusing cached queries: %s', request.state.cached_queries)
        return request.state.cached_queries

    if getattr(request.state, 'direct', False) and hasattr(request.state, 'model'):
        models = {
            **dict(request.app.state.MODELS.items()),
            request.state.model['id']: request.state.model,
        }
    else:
        models = request.app.state.MODELS

    model_id = form_data['model']
    if model_id not in models:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.MODEL_NOT_FOUND(),
        )

    task_model_id, task_model_params = await get_task_model_generation_config(model_id, models)

    log.debug('generating %s queries using model %s for user %s', type, task_model_id, user.email)

    query_template = await Config.get('task.query.prompt_template')
    if query_template.strip() != '':
        template = query_template
    else:
        template = DEFAULT_QUERY_GENERATION_PROMPT_TEMPLATE

    content = await query_generation_template(template, form_data['messages'], user)

    payload = {
        'model': task_model_id,
        'messages': [{'role': 'user', 'content': content}],
        'stream': False,
        'metadata': {
            **(request.state.metadata if hasattr(request.state, 'metadata') else {}),
            'task': str(TASKS.QUERY_GENERATION),
            'task_body': form_data,
            'chat_id': form_data.get('chat_id', None),
        },
    }

    # Process the payload through the pipeline
    try:
        payload = await process_pipeline_inlet_filter(request, payload, user, models)
    except Exception as e:
        raise e

    payload = apply_task_model_params(payload, models, task_model_id, task_model_params)

    try:
        return await generate_chat_completion(request, form_data=payload, user=user)
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={'detail': str(e)},
        )


@router.post('/auto/completions')
async def generate_autocompletion(request: Request, form_data: dict, user=Depends(get_verified_user)):
    if not await Config.get('task.autocomplete.enable'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ERROR_MESSAGES.FEATURE_DISABLED('Autocompletion generation'),
        )

    type = form_data.get('type')
    prompt = form_data.get('prompt')
    messages = form_data.get('messages')

    autocomplete_input_max_length = await Config.get('task.autocomplete.input_max_length')
    if autocomplete_input_max_length > 0:
        if len(prompt) > autocomplete_input_max_length:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ERROR_MESSAGES.INPUT_TOO_LONG(autocomplete_input_max_length),
            )

    if getattr(request.state, 'direct', False) and hasattr(request.state, 'model'):
        models = {
            **dict(request.app.state.MODELS.items()),
            request.state.model['id']: request.state.model,
        }
    else:
        models = request.app.state.MODELS

    model_id = form_data['model']
    if model_id not in models:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.MODEL_NOT_FOUND(),
        )

    task_model_id, task_model_params = await get_task_model_generation_config(model_id, models)

    log.debug('generating autocompletion using model %s for user %s', task_model_id, user.email)

    autocomplete_template = await Config.get('task.autocomplete.prompt_template')
    if autocomplete_template.strip() != '':
        template = autocomplete_template
    else:
        template = DEFAULT_AUTOCOMPLETE_GENERATION_PROMPT_TEMPLATE

    content = await autocomplete_generation_template(template, prompt, messages, type, user)

    payload = {
        'model': task_model_id,
        'messages': [{'role': 'user', 'content': content}],
        'stream': False,
        'metadata': {
            **(request.state.metadata if hasattr(request.state, 'metadata') else {}),
            'task': str(TASKS.AUTOCOMPLETE_GENERATION),
            'task_body': form_data,
            'chat_id': form_data.get('chat_id', None),
        },
    }

    # Process the payload through the pipeline
    try:
        payload = await process_pipeline_inlet_filter(request, payload, user, models)
    except Exception as e:
        raise e

    payload = apply_task_model_params(payload, models, task_model_id, task_model_params)

    try:
        return await generate_chat_completion(request, form_data=payload, user=user)
    except Exception as e:
        log.error(f'Error generating chat completion: {e}')
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={'detail': 'An internal error has occurred.'},
        )


@router.post('/emoji/completions')
async def generate_emoji(request: Request, form_data: dict, user=Depends(get_verified_user)):
    if getattr(request.state, 'direct', False) and hasattr(request.state, 'model'):
        models = {
            **dict(request.app.state.MODELS.items()),
            request.state.model['id']: request.state.model,
        }
    else:
        models = request.app.state.MODELS

    model_id = form_data['model']
    if model_id not in models:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.MODEL_NOT_FOUND(),
        )

    task_model_id, _ = await get_task_model_generation_config(model_id, models)

    log.debug('generating emoji using model %s for user %s ', task_model_id, user.email)

    template = DEFAULT_EMOJI_GENERATION_PROMPT_TEMPLATE

    content = await emoji_generation_template(template, form_data['prompt'], user)

    payload = {
        'model': task_model_id,
        'messages': [{'role': 'user', 'content': content}],
        'stream': False,
        'metadata': {
            **(request.state.metadata if hasattr(request.state, 'metadata') else {}),
            'task': str(TASKS.EMOJI_GENERATION),
            'task_body': form_data,
            'chat_id': form_data.get('chat_id', None),
        },
    }

    # Process the payload through the pipeline
    try:
        payload = await process_pipeline_inlet_filter(request, payload, user, models)
    except Exception as e:
        raise e

    payload = apply_task_model_params(payload, models, task_model_id, {'max_tokens': 4})

    try:
        return await generate_chat_completion(request, form_data=payload, user=user)
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={'detail': str(e)},
        )


@router.post('/moa/completions')
async def generate_moa_response(request: Request, form_data: dict, user=Depends(get_verified_user)):
    if getattr(request.state, 'direct', False) and hasattr(request.state, 'model'):
        models = {
            **dict(request.app.state.MODELS.items()),
            request.state.model['id']: request.state.model,
        }
    else:
        models = request.app.state.MODELS

    model_id = form_data['model']

    if model_id not in models:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ERROR_MESSAGES.MODEL_NOT_FOUND(),
        )

    template = DEFAULT_MOA_GENERATION_PROMPT_TEMPLATE

    content = moa_response_generation_template(
        template,
        form_data['prompt'],
        form_data['responses'],
    )

    payload = {
        'model': model_id,
        'messages': [{'role': 'user', 'content': content}],
        'stream': form_data.get('stream', False),
        'metadata': {
            **(request.state.metadata if hasattr(request.state, 'metadata') else {}),
            'chat_id': form_data.get('chat_id', None),
            'task': str(TASKS.MOA_RESPONSE_GENERATION),
            'task_body': form_data,
        },
    }

    # Process the payload through the pipeline
    try:
        payload = await process_pipeline_inlet_filter(request, payload, user, models)
    except Exception as e:
        raise e

    try:
        return await generate_chat_completion(request, form_data=payload, user=user)
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={'detail': str(e)},
        )
