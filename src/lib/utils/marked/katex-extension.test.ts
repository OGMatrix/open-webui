import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import katexExtension from './katex-extension';

marked.use(katexExtension({ throwOnError: false }));

/** The renderer keys off these token types, so this is what "recognised" means. */
const findKatex = (tokens: any[]): any => {
	for (const token of tokens ?? []) {
		if (token.type === 'inlineKatex' || token.type === 'blockKatex') return token;
		const nested = findKatex(token.tokens ?? token.items ?? []);
		if (nested) return nested;
	}
	return null;
};

const tokenFor = (src: string) => findKatex(marked.lexer(src) as any[]);

describe('delimiters', () => {
	it('recognises the dollar and paren forms', () => {
		expect(tokenFor('Die Formel $E = mc^2$ gilt.')?.text).toBe('E = mc^2');
		expect(tokenFor('$$\\frac{a}{b}$$')?.text).toBe('\\frac{a}{b}');
		expect(tokenFor('Inline \\(x^2\\) hier.')?.text).toBe('x^2');
		expect(tokenFor('\\[x^2\\]')?.text).toBe('x^2');
	});

	it('recognises mhchem', () => {
		expect(tokenFor('Reaktion \\ce{H2O} hier.')?.text).toBe('H2O');
	});
});

describe('bare math environments', () => {
	// Models emit these without wrapping $$ around them. Before they were matched
	// here, the whole block reached the reader as literal source.
	const environments = [
		'align',
		'align*',
		'alignat',
		'aligned',
		'array',
		'bmatrix',
		'Bmatrix',
		'cases',
		'CD',
		'dcases',
		'equation',
		'equation*',
		'gather',
		'gather*',
		'gathered',
		'matrix',
		'pmatrix',
		'rcases',
		'smallmatrix',
		'split',
		'subarray',
		'vmatrix',
		'Vmatrix'
	];

	for (const environment of environments) {
		it(`recognises \\begin{${environment}}`, () => {
			const src = `\\begin{${environment}}a &= b\\end{${environment}}`;
			expect(tokenFor(src)).toBeTruthy();
		});
	}

	it('keeps the wrapper in the text, since KaTeX needs the environment', () => {
		// `a &= b` on its own is a KaTeX error; the environment is what makes it valid.
		const token = tokenFor('\\begin{align}a &= b\\end{align}');
		expect(token.text).toBe('\\begin{align}a &= b\\end{align}');
		expect(token.displayMode).toBe(true);
	});

	it('prefers the starred name over the unstarred one', () => {
		expect(tokenFor('\\begin{align*}a &= b\\end{align*}')?.text).toBe(
			'\\begin{align*}a &= b\\end{align*}'
		);
	});

	it('matches mid-paragraph, not only on its own line', () => {
		expect(tokenFor('Daraus folgt \\begin{align}a &= b\\end{align} und weiter.')).toBeTruthy();
	});

	it('spans multiple lines', () => {
		const token = tokenFor('\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}');
		expect(token?.text).toContain('c &= d');
	});

	it('stops at its own closing tag rather than a later one', () => {
		const token = tokenFor('\\begin{cases}1\\end{cases} und \\begin{cases}2\\end{cases}');
		expect(token?.raw).toBe('\\begin{cases}1\\end{cases}');
	});

	it('leaves an unknown environment alone', () => {
		expect(tokenFor('\\begin{tikzpicture}x\\end{tikzpicture}')).toBeNull();
	});

	it('leaves an unterminated environment alone', () => {
		expect(tokenFor('\\begin{align}a &= b')).toBeNull();
	});
});
