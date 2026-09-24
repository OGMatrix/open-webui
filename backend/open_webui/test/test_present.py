import base64

import pytest
from open_webui.utils.present import (
    PresentError,
    _media_bytes,
    bytes_from_content,
    content_type_for,
    file_name_for,
    format_size,
)


class TestNamingTheDownload:
    def test_takes_the_name_the_model_asked_for(self):
        assert file_name_for('Report Q3.pdf', '/work/out/tmp1234.pdf') == 'Report Q3.pdf'

    def test_falls_back_to_the_file_at_the_end_of_the_path(self):
        assert file_name_for('', '/work/out/bericht.pdf') == 'bericht.pdf'

    def test_drops_the_directory_part_of_a_name(self):
        # A name is what the download is called, never where it came from.
        assert '/' not in file_name_for('../../etc/passwd')
        assert '\\' not in file_name_for('..\\windows\\system32\\drivers')

    def test_refuses_to_end_up_with_nothing(self):
        assert file_name_for('', '') == 'file'
        assert file_name_for('/', '/') == 'file'
        assert file_name_for('...') == 'file'

    def test_gives_a_bare_name_the_extension_its_type_implies(self):
        assert file_name_for('notes', '', 'text/markdown') == 'notes.md'
        assert file_name_for('notes.md', '', 'text/markdown') == 'notes.md'

    def test_keeps_a_name_within_what_a_filesystem_takes(self):
        assert len(file_name_for('a' * 400)) == 255

    def test_strips_control_characters(self):
        assert file_name_for('re\nport\t.txt') == 'report.txt'


class TestWhatKindOfFileItIs:
    def test_believes_a_declared_type(self):
        assert content_type_for('data.bin', 'application/pdf') == 'application/pdf'

    def test_ignores_the_type_that_says_nothing(self):
        assert content_type_for('report.pdf', 'application/octet-stream') == 'application/pdf'

    def test_guesses_from_the_name_when_nothing_is_declared(self):
        assert content_type_for('notes.md') == 'text/markdown'

    def test_falls_back_to_bytes_for_something_unknown(self):
        assert content_type_for('archive.unheardof') == 'application/octet-stream'

    def test_lets_the_name_beat_a_type_that_says_nothing(self):
        # Content written into the call arrives as plain text, whatever it is.
        assert content_type_for('notes.md', 'text/plain') == 'text/markdown'
        # Fixed for the common text formats, so a Windows server does not hand a
        # CSV over as an Excel file the way its registry would have it.

        assert content_type_for('data.csv', 'text/plain') == 'text/csv'
        assert content_type_for('notes.txt', 'text/plain') == 'text/plain'

    def test_drops_the_charset_a_server_appends(self):
        assert content_type_for('a.csv', 'text/csv; charset=utf-8') == 'text/csv'


class TestContentTheModelWrote:
    def test_plain_text_is_the_file(self):
        data, content_type = bytes_from_content('# Titel\nZeile')
        assert data == b'# Titel\nZeile'
        assert content_type == 'text/plain'

    def test_decodes_a_base64_data_uri(self):
        raw = b'\x89PNG\r\n\x1a\n'
        data, content_type = bytes_from_content('data:image/png;base64,' + base64.b64encode(raw).decode())
        assert data == raw
        assert content_type == 'image/png'

    def test_reads_a_data_uri_that_is_not_encoded(self):
        data, content_type = bytes_from_content('data:text/csv,a,b,c')
        assert data == b'a,b,c'
        assert content_type == 'text/csv'

    def test_says_so_when_the_base64_is_broken(self):
        with pytest.raises(PresentError):
            bytes_from_content('data:image/png;base64,not base64 at all!!')

    def test_text_that_merely_starts_with_data_is_still_text(self):
        data, content_type = bytes_from_content('database notes')
        assert data == b'database notes'
        assert content_type == 'text/plain'


class TestBinaryFromAFilesystemServer:
    def test_reads_the_base64_block_and_its_type(self):
        raw = b'\x00\x01binary'
        found = _media_bytes([{'type': 'image', 'data': base64.b64encode(raw).decode(), 'mimeType': 'image/webp'}])
        assert found == (raw, 'image/webp')

    def test_walks_past_the_text_a_server_puts_first(self):
        raw = b'pdf'
        found = _media_bytes(
            [
                {'type': 'text', 'text': 'here you go'},
                {'type': 'blob', 'data': base64.b64encode(raw).decode()},
            ]
        )
        assert found == (raw, '')

    def test_none_when_there_is_only_text(self):
        assert _media_bytes([{'type': 'text', 'text': 'nothing binary here'}]) is None

    def test_none_for_an_answer_with_no_blocks(self):
        assert _media_bytes(None) is None
        assert _media_bytes([]) is None


class TestSizeAsAPersonReadsIt:
    def test_bytes_stay_whole(self):
        assert format_size(512) == '512 B'

    def test_a_small_number_keeps_one_decimal(self):
        assert format_size(2_500_000) == '2.4 MB'

    def test_a_large_number_drops_the_decimal(self):
        assert format_size(150 * 1024) == '150 KB'

    def test_nothing_is_nothing(self):
        assert format_size(0) == '0 B'
