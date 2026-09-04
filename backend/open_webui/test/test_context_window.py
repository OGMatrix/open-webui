"""Where each provider states its context window, and which one wins.

The shapes below are not invented: they are what Open WebUI stores for
OpenRouter, LM Studio, llama.cpp, a llama.cpp router, Ollama and vLLM, taken
from the model documents the backend keeps and hands to the client.
"""

from open_webui.utils.context_window import (
    DEFAULT_CONTEXT_WINDOW,
    get_context_window,
    get_max_output_tokens,
)


class TestWhereProvidersStateIt:
    def test_openrouter_and_most_gateways(self):
        assert get_context_window({'context_length': 200000}) == 200000

    def test_lm_studio(self):
        assert get_context_window({'max_context_length': 8192}) == 8192

    def test_vllm(self):
        assert get_context_window({'max_model_len': 65536}) == 65536

    def test_llama_cpp_v1_models(self):
        assert get_context_window({'meta': {'n_ctx_train': 32768}}) == 32768

    def test_llama_cpp_router_reads_the_served_size_off_the_command_line(self):
        # The router's own /props says n_ctx 0, so the per-model size appears
        # only in the arguments its instance was started with.
        model = {'status': {'args': ['--model', 'qwen3.gguf', '--ctx-size', '16384', '--port', '8080']}}
        assert get_context_window(model) == 16384
        assert get_context_window({'status': {'args': ['-c', '4096']}}) == 4096

    def test_ollama_under_an_architecture_prefixed_key(self):
        model = {'ollama': {'model_info': {'general.architecture': 'qwen3', 'qwen3.context_length': 40960}}}
        assert get_context_window(model) == 40960

    def test_a_model_that_says_nothing(self):
        assert get_context_window({'id': 'mystery'}) is None
        assert get_context_window(None) is None
        assert get_context_window({}) is None


class TestPrecedence:
    def test_an_explicit_num_ctx_beats_everything(self):
        # A user who pinned num_ctx meant it, and Ollama will honour it over
        # the trained size.
        model = {'context_length': 131072, 'meta': {'n_ctx_train': 131072}}
        assert get_context_window(model, {'num_ctx': 4096}) == 4096

    def test_a_model_preset_beats_the_provider(self):
        model = {'context_length': 131072, 'info': {'params': {'num_ctx': 8192}}}
        assert get_context_window(model) == 8192

    def test_the_chat_beats_the_model_preset(self):
        model = {'info': {'params': {'num_ctx': 8192}}}
        assert get_context_window(model, {'num_ctx': 2048}) == 2048

    def test_the_served_size_beats_the_trained_size(self):
        # A 128k model served with --ctx-size 8192 has 8192 tokens.
        model = {'meta': {'n_ctx_train': 131072}, 'status': {'args': ['--ctx-size', '8192']}}
        assert get_context_window(model) == 8192


class TestRefusingToGuess:
    def test_rejects_values_that_are_not_a_size(self):
        for value in (0, -1, 'lots', None, False, True, [], {}):
            assert get_context_window({'context_length': value}) is None

    def test_reads_a_size_that_arrived_as_a_string(self):
        # Command-line arguments and some gateways send numbers as text.
        assert get_context_window({'context_length': '32768'}) == 32768
        assert get_context_window({'status': {'args': ['--ctx-size', '16384']}}) == 16384

    def test_skips_a_zero_and_keeps_looking(self):
        # A llama.cpp router reports n_ctx 0; that is not an answer.
        model = {'n_ctx': 0, 'context_length': 4096}
        assert get_context_window(model) == 4096

    def test_survives_malformed_provider_documents(self):
        for model in ({'status': 'not a dict'}, {'ollama': {'model_info': 'not a dict'}}, {'meta': None}):
            assert get_context_window(model) is None

    def test_the_floor_is_a_floor_not_a_guess(self):
        # Nothing returns the default automatically; the caller decides to use
        # it, so a real answer is never quietly replaced by an assumption.
        assert DEFAULT_CONTEXT_WINDOW == 8192
        assert get_context_window({}) is None


class TestOutputRoom:
    def test_reads_the_generation_limit_the_input_must_leave_room_for(self):
        assert get_max_output_tokens(None, {'max_tokens': 4096}) == 4096
        assert get_max_output_tokens(None, {'num_predict': 2048}) == 2048
        assert get_max_output_tokens({'info': {'params': {'max_tokens': 1024}}}) == 1024
        assert get_max_output_tokens({'top_provider': {'max_completion_tokens': 16384}}) == 16384

    def test_says_nothing_when_no_limit_is_set(self):
        assert get_max_output_tokens(None, None) is None
        assert get_max_output_tokens({}, {}) is None

    def test_ignores_ollamas_unlimited_sentinel(self):
        # num_predict -1 means "until the model stops", not a token budget.
        assert get_max_output_tokens(None, {'num_predict': -1}) is None
