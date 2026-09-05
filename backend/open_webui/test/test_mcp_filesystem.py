from open_webui.utils.mcp.filesystem import (
    is_filesystem_server,
    parse_allowed_directories,
    parse_directory_listing,
    parse_file_info,
    resolve_tools,
    result_text,
)


def spec(name):
    return {'name': name, 'description': '', 'parameters': {}}


def text(*lines):
    """A tool result the way MCP delivers one."""
    return [{'type': 'text', 'text': '\n'.join(lines)}]


class TestRecognisingAServer:
    def test_picks_the_richer_listing_tool_when_both_are_offered(self):
        tools = resolve_tools([spec('list_directory'), spec('list_directory_with_sizes')])
        assert tools['list'] == 'list_directory_with_sizes'

    def test_falls_back_to_the_plain_one(self):
        assert resolve_tools([spec('list_directory')])['list'] == 'list_directory'

    def test_ignores_tools_it_has_no_use_for(self):
        tools = resolve_tools([spec('list_directory'), spec('write_file'), spec('move_file')])
        assert set(tools.values()) == {'list_directory'}

    def test_never_maps_an_operation_onto_a_writing_tool(self):
        # The point of the allowlist: a server offering write_file must not end
        # up with it reachable through any operation the browser can ask for.
        tools = resolve_tools([spec(name) for name in ('write_file', 'edit_file', 'move_file', 'create_directory')])
        assert tools == {}

    def test_a_server_that_can_list_is_a_filesystem(self):
        assert is_filesystem_server([spec('list_directory')]) is True

    def test_a_server_that_can_only_read_one_file_is_not(self):
        # Nothing to draw a tree from.
        assert is_filesystem_server([spec('read_file')]) is False

    def test_a_server_with_no_tools_is_not(self):
        assert is_filesystem_server([]) is False
        assert is_filesystem_server(None) is False


class TestReadingResultText:
    def test_joins_the_text_blocks_in_order(self):
        assert result_text([{'type': 'text', 'text': 'a'}, {'type': 'text', 'text': 'b'}]) == 'a\nb'

    def test_skips_blocks_that_are_not_text(self):
        blocks = [{'type': 'image', 'data': '...'}, {'type': 'text', 'text': 'only this'}]
        assert result_text(blocks) == 'only this'

    def test_survives_nothing_at_all(self):
        assert result_text(None) == ''


class TestParsingADirectory:
    def test_reads_the_documented_text_layout(self):
        result = parse_directory_listing(text('[DIR] src', '[FILE] README.md'))
        assert result['parsed'] is True
        assert result['entries'] == [
            {'name': 'src', 'type': 'directory', 'size': None},
            {'name': 'README.md', 'type': 'file', 'size': None},
        ]

    def test_reads_the_sizes_the_richer_tool_appends(self):
        result = parse_directory_listing(text('[FILE] notes.md          1.5 KB', '[DIR] build'))
        assert result['entries'][0]['size'] == 1536
        assert result['entries'][1]['size'] is None

    def test_understands_plain_bytes(self):
        result = parse_directory_listing(text('[FILE] tiny.txt          512 B'))
        assert result['entries'][0]['size'] == 512

    def test_keeps_a_name_that_contains_spaces(self):
        # The failure this exists for: splitting on whitespace would cut the
        # name in half, and files with spaces in them are ordinary.
        result = parse_directory_listing(text('[FILE] quarterly report.pdf          2 MB'))
        assert result['entries'][0]['name'] == 'quarterly report.pdf'
        assert result['entries'][0]['size'] == 2097152

    def test_keeps_a_name_with_a_single_space_run_that_is_not_a_size(self):
        result = parse_directory_listing(text('[FILE] my file.txt'))
        assert result['entries'][0]['name'] == 'my file.txt'

    def test_ignores_the_summary_lines_that_follow(self):
        result = parse_directory_listing(
            text('[FILE] a.txt', '', 'Total: 1 files, 0 directories', 'Combined size: 12 B')
        )
        assert [entry['name'] for entry in result['entries']] == ['a.txt']

    def test_prefers_structured_output_when_the_server_sends_it(self):
        structured = [
            {'name': 'src', 'type': 'directory'},
            {'name': 'main.py', 'type': 'file', 'size': 42},
        ]
        result = parse_directory_listing(text('unparseable noise'), structured=structured)
        assert result['entries'][1] == {'name': 'main.py', 'type': 'file', 'size': 42}

    def test_reads_json_sent_as_text(self):
        result = parse_directory_listing(text('[{"name": "docs", "type": "directory"}]'))
        assert result['entries'] == [{'name': 'docs', 'type': 'directory', 'size': None}]

    def test_unwraps_a_list_the_server_put_under_a_key(self):
        result = parse_directory_listing(None, structured={'entries': [{'name': 'a', 'type': 'file'}]})
        assert result['entries'][0]['name'] == 'a'

    def test_treats_something_with_children_as_a_directory(self):
        result = parse_directory_listing(None, structured=[{'name': 'src', 'children': []}])
        assert result['entries'][0]['type'] == 'directory'

    def test_reduces_a_full_path_to_a_name(self):
        result = parse_directory_listing(None, structured=[{'name': '/srv/app/main.py', 'type': 'file'}])
        assert result['entries'][0]['name'] == 'main.py'

    def test_says_so_when_it_could_not_read_the_answer(self):
        # The failure this exists for: reporting an empty directory when the
        # server in fact said something the parser did not know, which reads as
        # "there are no files here" and is a lie.
        result = parse_directory_listing(text('Permission denied while reading /srv'))
        assert result['parsed'] is False
        assert result['entries'] == []
        assert 'Permission denied' in result['raw']

    def test_an_empty_directory_is_not_a_parse_failure_it_can_hide(self):
        result = parse_directory_listing(text(''))
        assert result['entries'] == []
        assert result['parsed'] is False


class TestParsingTheRoots:
    def test_reads_the_list_under_its_header(self):
        roots = parse_allowed_directories(text('Allowed directories:', '/srv/app', '/home/data'))
        assert roots == ['/srv/app', '/home/data']

    def test_reads_json(self):
        assert parse_allowed_directories(text('["/srv/app"]')) == ['/srv/app']

    def test_reads_a_list_under_a_key(self):
        assert parse_allowed_directories(None, structured={'directories': ['/a']}) == ['/a']

    def test_has_nothing_to_say_about_an_empty_answer(self):
        assert parse_allowed_directories(text('')) == []


class TestParsingFileInfo:
    def test_reads_the_documented_text_layout(self):
        info = parse_file_info(
            text(
                'size: 1234',
                'created: 2026-01-02T03:04:05.000Z',
                'modified: 2026-02-03T04:05:06.000Z',
                'accessed: 2026-02-03T04:05:06.000Z',
                'isDirectory: false',
                'isFile: true',
                'permissions: 644',
            )
        )
        assert info['size'] == 1234
        assert info['modified'] == '2026-02-03T04:05:06.000Z'
        assert info['isDirectory'] is False
        assert info['isFile'] is True

    def test_reads_a_size_that_carries_its_unit(self):
        assert parse_file_info(text('size: 2048 bytes'))['size'] == 2048

    def test_prefers_structured_output(self):
        assert parse_file_info(text('size: 1'), structured={'size': 99})['size'] == 99

    def test_returns_nothing_rather_than_guessing(self):
        assert parse_file_info(text('who knows')) == {}
