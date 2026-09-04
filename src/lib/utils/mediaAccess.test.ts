import { describe, expect, it } from 'vitest';
import {
	canWriteClipboard,
	mediaAccessMessage,
	mediaApiUnavailable,
	readMediaErrorReason,
	requestMicrophone,
	type MediaScope
} from './mediaAccess';

/** A page served over https, or on localhost: the API is there. */
const secure = (getUserMedia: unknown = () => Promise.resolve({} as MediaStream)): MediaScope => ({
	isSecureContext: true,
	navigator: { mediaDevices: { getUserMedia } },
	location: { origin: 'https://chat.example.com' }
});

/** A page served over http to a LAN address: the browser withholds the API. */
const insecure = (): MediaScope => ({
	isSecureContext: false,
	navigator: {},
	location: { origin: 'http://192.168.10.134' }
});

/** A secure page in a browser that simply has no media capture. */
const ancient = (): MediaScope => ({
	isSecureContext: true,
	navigator: {},
	location: { origin: 'https://chat.example.com' }
});

const domError = (name: string) => Object.assign(new Error(name), { name });

describe('telling a missing API from a refused one', () => {
	it('says nothing is wrong when the API is there', () => {
		expect(mediaApiUnavailable(secure())).toBeNull();
	});

	it('names the insecure page, which is what no amount of clicking Allow fixes', () => {
		// The reported failure: an instance served over http to a LAN address.
		// `navigator.mediaDevices` does not exist, so nothing was ever asked.
		expect(mediaApiUnavailable(insecure())).toBe('insecure-context');
	});

	it('separates a browser that cannot from a page that may not', () => {
		expect(mediaApiUnavailable(ancient())).toBe('unsupported');
	});

	it('trusts the browser about what counts as secure', () => {
		// localhost over http is a secure context; reimplementing that rule is
		// how you get it wrong for .localhost, file:// and 127.0.0.1.
		const localhost: MediaScope = {
			isSecureContext: true,
			navigator: { mediaDevices: { getUserMedia: () => Promise.resolve({} as MediaStream) } }
		};
		expect(mediaApiUnavailable(localhost)).toBeNull();
	});

	it('survives an environment that has nothing at all', () => {
		expect(mediaApiUnavailable({})).toBe('unsupported');
		expect(() => mediaApiUnavailable(undefined as never)).not.toThrow();
	});
});

describe('reading what a rejection meant', () => {
	it.each([
		['NotAllowedError', 'denied'],
		['SecurityError', 'denied'],
		['PermissionDeniedError', 'denied'],
		['NotFoundError', 'not-found'],
		['OverconstrainedError', 'not-found'],
		['NotReadableError', 'in-use'],
		['TrackStartError', 'in-use'],
		['AbortError', 'in-use']
	])('reads %s as %s', (name, expected) => {
		expect(readMediaErrorReason(domError(name), secure())).toBe(expected);
	});

	it('reads a TypeError as the missing API it usually is', () => {
		// `navigator.mediaDevices.getUserMedia` on an insecure page throws this
		// before any permission is involved, and it used to surface as a denial.
		expect(readMediaErrorReason(new TypeError('undefined is not an object'), insecure())).toBe(
			'insecure-context'
		);
	});

	it('does not blame the page when the API is present', () => {
		expect(readMediaErrorReason(new TypeError('bad constraint'), secure())).toBe('unknown');
	});

	it('admits when it does not know', () => {
		expect(readMediaErrorReason(domError('SomethingNew'), secure())).toBe('unknown');
		expect(readMediaErrorReason(null, secure())).toBe('unknown');
		expect(readMediaErrorReason('a string', secure())).toBe('unknown');
	});
});

describe('asking for the microphone', () => {
	it('hands back the stream when it is granted', async () => {
		const stream = { id: 'mic' } as unknown as MediaStream;
		const result = await requestMicrophone(
			{ audio: true },
			secure(() => Promise.resolve(stream))
		);
		expect(result).toEqual({ stream });
	});

	it('reports the insecure page without calling anything', async () => {
		let called = false;
		const scope = insecure();
		scope.navigator = {
			mediaDevices: undefined
		};
		const result = await requestMicrophone({ audio: true }, scope);
		expect(result).toEqual({ reason: 'insecure-context' });
		expect(called).toBe(false);
	});

	it('turns a rejection into a reason rather than an exception', async () => {
		const result = await requestMicrophone(
			{ audio: true },
			secure(() => Promise.reject(domError('NotAllowedError')))
		);
		expect(result).toEqual({ reason: 'denied' });
	});

	it('survives a getUserMedia that throws synchronously', async () => {
		const result = await requestMicrophone(
			{ audio: true },
			secure(() => {
				throw domError('NotReadableError');
			})
		);
		expect(result).toEqual({ reason: 'in-use' });
	});
});

describe('what the user is told', () => {
	it('says the page is the problem, not the permission', () => {
		const { key } = mediaAccessMessage('insecure-context', 'http://192.168.10.134');
		expect(key).toContain('secure page');
		expect(key).not.toContain('denied');
	});

	it('points at both places a refusal can come from', () => {
		// The operating system refuses too, and its setting is not in the
		// browser -- which is where people look first and find nothing wrong.
		const { key } = mediaAccessMessage('denied');
		expect(key).toContain('browser');
		expect(key).toContain('system');
	});

	it('has something for every reason', () => {
		for (const reason of [
			'insecure-context',
			'unsupported',
			'denied',
			'not-found',
			'in-use',
			'unknown'
		] as const) {
			expect(mediaAccessMessage(reason).key.length).toBeGreaterThan(0);
		}
	});
});

describe('whether the clipboard can be written', () => {
	it('is true when the async API is there', () => {
		expect(canWriteClipboard({ navigator: { clipboard: { writeText: () => {} } } } as never)).toBe(
			true
		);
	});

	it('is still true on an insecure page, because copying has a fallback', () => {
		// This is the distinction that was missed: writing survives an insecure
		// page through execCommand, reading does not survive at all.
		expect(
			canWriteClipboard({ navigator: {}, document: { execCommand: () => true } } as never)
		).toBe(true);
	});

	it('is false when there is no way to write at all', () => {
		expect(canWriteClipboard({ navigator: {} } as never)).toBe(false);
	});
});
