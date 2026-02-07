import { extractBackgroundImageUrls } from '../../utils/cssBackground';

test('extractBackgroundImageUrls ignores gradients', () => {
  const urls = extractBackgroundImageUrls("linear-gradient(red, blue), url('a.jpg'), url(\"b.png\")");
  expect(urls).toEqual(['a.jpg', 'b.png']);
});
