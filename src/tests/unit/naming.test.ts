import { buildFilenames } from '../../utils/naming';

test('buildFilenames uses template and zero pad', () => {
  const names = buildFilenames(2, { template: 'Pic ({index}).{ext}', startIndex: 1, zeroPad: 3, includeHint: true }, ['one', 'two'], 'webp');
  expect(names).toEqual(['Pic (001).webp', 'Pic (002).webp']);
});

test('buildFilenames can disable hint token replacement', () => {
  const names = buildFilenames(1, { template: '{name}-{index}.{ext}', startIndex: 7, zeroPad: 2, includeHint: false }, ['origin'], 'png');
  expect(names).toEqual(['Pic-07.png']);
});
