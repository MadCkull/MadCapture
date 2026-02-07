import { buildFilenames } from '../../utils/naming';

test('buildFilenames uses template and zero pad', () => {
  const names = buildFilenames(2, { template: 'Pic ({index}).{ext}', startIndex: 1, zeroPad: 3 }, ['one', 'two'], 'webp');
  expect(names).toEqual(['Pic (001).webp', 'Pic (002).webp']);
});
