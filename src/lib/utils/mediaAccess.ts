/**
 * Telling "you said no" apart from "the browser never asked".
 *
 * Microphone access reported itself as a permission denial whatever went
 * wrong, including the case where no permission was ever requested. On a page
 * served over http:// to anything but localhost, `navigator.mediaDevices` does
 * not exist at all: the very first property access throws, the catch fires,
 * and the interface says the microphone was refused. Nothing was refused. The
 * browser withheld the API, and no amount of clicking Allow will produce it —
 * so the one thing the message has to say is the one thing it did not.
 *
 * The same shape catches out the clipboard, `showDirectoryPicker`, service
 * workers and notifications: all secure-context only, all easy to mistake for
 * a permission the user can grant.
 */

/** Why a media device could not be reached. */
export type MediaAccessReason =
	/** The page is not a secure context, so the API is not present at all. */
	| 'insecure-context'
	/** A secure page, but this browser has no such API. */
	| 'unsupported'
	/** Asked and refused, by the user or by the operating system. */
	| 'denied'
	/** There is no such device. */
	| 'not-found'
	/** Something else holds it. */
	| 'in-use'
	| 'unknown';

/**
 * What the check reads from the environment.
 *
 * Injectable because the interesting states -- an insecure page, a browser
 * without the API -- cannot be reached from a test runner that has no DOM at
 * all, and pretending otherwise would mean the branch that matters is the one
 * never exercised.
 */
export type MediaScope = {
	isSecureContext?: boolean;
	navigator?: { mediaDevices?: { getUserMedia?: unknown } };
	location?: { origin?: string; protocol?: string; hostname?: string };
};

const currentScope = (): MediaScope =>
	(typeof globalThis === 'undefined' ? {} : (globalThis as unknown as MediaScope)) ?? {};

/**
 * Whether the microphone API is missing before anything is even asked, and why.
 *
 * Null means the API is there; whatever happens next is a real answer to a
 * real question.
 */
export const mediaApiUnavailable = (
	scope: MediaScope = currentScope()
): 'insecure-context' | 'unsupported' | null => {
	if (typeof scope?.navigator?.mediaDevices?.getUserMedia === 'function') {
		return null;
	}
	// `isSecureContext` is the browser's own word for it, and the only reliable
	// one: localhost counts as secure, a LAN address over http does not, and the
	// rules differ enough between browsers not to reimplement them here.
	return scope?.isSecureContext === false ? 'insecure-context' : 'unsupported';
};

/** Where the page is served from, for a message that can name it. */
export const currentOrigin = (scope: MediaScope = currentScope()): string =>
	scope?.location?.origin ?? '';

/**
 * What a getUserMedia rejection actually means.
 *
 * The names come from the Media Capture spec; browsers agree on them far more
 * than they agree on the messages, which is why the message is not what gets
 * read.
 */
export const readMediaErrorReason = (
	error: unknown,
	scope: MediaScope = currentScope()
): MediaAccessReason => {
	// A TypeError here is almost always the property access on a missing API
	// rather than a bad constraint, so it is worth asking why the API is gone.
	if (error instanceof TypeError) {
		return mediaApiUnavailable(scope) ?? 'unknown';
	}

	const name = (error as { name?: string } | null)?.name ?? '';
	switch (name) {
		case 'NotAllowedError':
		case 'SecurityError':
		case 'PermissionDeniedError':
			return 'denied';
		case 'NotFoundError':
		case 'DevicesNotFoundError':
		case 'OverconstrainedError':
			return 'not-found';
		case 'NotReadableError':
		case 'TrackStartError':
		case 'AbortError':
			return 'in-use';
		default:
			return 'unknown';
	}
};

/** The i18n key for a reason, and what to interpolate into it. */
export const mediaAccessMessage = (
	reason: MediaAccessReason,
	origin = ''
): { key: string; params: Record<string, string> } => {
	switch (reason) {
		case 'insecure-context':
			return {
				key: 'Your browser only allows microphone access on a secure page. Open this over HTTPS, or on localhost, to record audio.',
				params: { origin }
			};
		case 'unsupported':
			return { key: 'This browser cannot record audio.', params: {} };
		case 'denied':
			return {
				key: 'Microphone access was refused. Allow it for this site in your browser, and check your system privacy settings.',
				params: { origin }
			};
		case 'not-found':
			return { key: 'No microphone was found.', params: {} };
		case 'in-use':
			return { key: 'The microphone is in use by another application.', params: {} };
		default:
			return { key: 'Permission denied when accessing microphone', params: {} };
	}
};

/**
 * Ask for the microphone, and fail with a reason rather than an exception.
 *
 * The unavailable case is checked before calling, so a missing API is reported
 * as a missing API instead of arriving as a TypeError that reads like a denial.
 */
export const requestMicrophone = async (
	constraints: MediaStreamConstraints = { audio: true },
	scope: MediaScope = currentScope()
): Promise<{ stream: MediaStream } | { reason: MediaAccessReason }> => {
	const unavailable = mediaApiUnavailable(scope);
	if (unavailable) {
		return { reason: unavailable };
	}

	try {
		const getUserMedia = scope.navigator!.mediaDevices!.getUserMedia as (
			c: MediaStreamConstraints
		) => Promise<MediaStream>;
		return { stream: await getUserMedia.call(scope.navigator!.mediaDevices, constraints) };
	} catch (error) {
		return { reason: readMediaErrorReason(error, scope) };
	}
};

/**
 * Whether the clipboard can be written to at all.
 *
 * Worth its own answer because writing survives an insecure page — there is a
 * `document.execCommand('copy')` fallback — while reading does not, and the
 * two used to be conflated.
 */
export const canWriteClipboard = (scope: MediaScope = currentScope()): boolean => {
	const nav = scope?.navigator as { clipboard?: { writeText?: unknown } } | undefined;
	if (typeof nav?.clipboard?.writeText === 'function') {
		return true;
	}
	const doc = (scope as { document?: { execCommand?: unknown } })?.document;
	return typeof doc?.execCommand === 'function';
};
