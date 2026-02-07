import { parseSrcset, pickHighestResCandidate } from '../../utils/srcset';

test('parseSrcset parses candidates', () => {
  const out = parseSrcset('a.jpg 320w, b.jpg 2x');
  expect(out).toHaveLength(2);
  expect(out[0].width).toBe(320);
  expect(out[1].density).toBe(2);
});

test('pickHighestResCandidate picks highest descriptor', () => {
  expect(pickHighestResCandidate('a.jpg 320w, c.jpg 1080w')).toBe('c.jpg');
});
