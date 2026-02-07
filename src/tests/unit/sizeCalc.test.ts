import { compareBySizeDesc } from '../../utils/sizeCalc';

test('compareBySizeDesc uses bytes then area', () => {
  const list = [
    { id: '1', url: 'a', originType: 'img' as const, bytes: 1000, width: 10, height: 10 },
    { id: '2', url: 'b', originType: 'img' as const, bytes: 2000, width: 5, height: 5 }
  ];
  list.sort(compareBySizeDesc);
  expect(list[0].id).toBe('2');
});
