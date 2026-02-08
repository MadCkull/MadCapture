import { buildFilenames } from '../../utils/naming';

test('buildFilenames uses base name with numbering and extension', () => {
  const names = buildFilenames(3, { baseName: 'Insta Image' }, 'png');
  expect(names).toEqual(['Insta Image (1).png', 'Insta Image (2).png', 'Insta Image (3).png']);
});

test('buildFilenames falls back to Pic when base name is empty', () => {
  const names = buildFilenames(2, { baseName: '   ' }, 'webp');
  expect(names).toEqual(['Pic (1).webp', 'Pic (2).webp']);
});
