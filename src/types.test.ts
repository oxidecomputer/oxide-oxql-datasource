import { mapObj, snakeToCamel } from './types';

describe('mapObj', () => {
  const camelCase = mapObj(snakeToCamel);

  it('converts top-level keys', () => {
    expect(camelCase({ foo_bar: 1 })).toEqual({ fooBar: 1 });
  });

  it('converts nested keys', () => {
    expect(camelCase({ outer_key: { inner_key: 'val' } })).toEqual({ outerKey: { innerKey: 'val' } });
  });

  it('converts keys inside arrays', () => {
    expect(camelCase([{ some_key: 1 }, { other_key: 2 }])).toEqual([{ someKey: 1 }, { otherKey: 2 }]);
  });

  it('passes through primitives', () => {
    expect(camelCase('hello')).toBe('hello');
    expect(camelCase(42)).toBe(42);
    expect(camelCase(null)).toBe(null);
  });

  describe('with skip paths', () => {
    const transform = mapObj(snakeToCamel, (_, v) => v, new Set(['parent.skip_me']));

    it('skips the specified path', () => {
      const input = { parent: { skip_me: { nested_key: 'val' } } };
      const result = transform(input) as Record<string, unknown>;
      expect(result).toEqual({ parent: { skip_me: { nested_key: 'val' } } });
    });

    it('still converts sibling keys', () => {
      const input = { parent: { skip_me: { nested_key: 'val' }, other_key: 'val' } };
      const result = transform(input) as Record<string, unknown>;
      expect(result).toEqual({ parent: { skip_me: { nested_key: 'val' }, otherKey: 'val' } });
    });

    it('still converts keys at other paths', () => {
      const input = { other_parent: { skip_me: { nested_key: 'val' } } };
      const result = transform(input) as Record<string, unknown>;
      expect(result).toEqual({ otherParent: { skipMe: { nestedKey: 'val' } } });
    });

    it('skips paths through arrays', () => {
      const transform = mapObj(snakeToCamel, (_, v) => v, new Set(['items.nested_obj']));
      const input = { items: [{ nested_obj: { deep_key: 1 } }, { nested_obj: { deep_key: 2 } }] };
      const result = transform(input) as Record<string, unknown>;
      expect(result).toEqual({ items: [{ nested_obj: { deep_key: 1 } }, { nested_obj: { deep_key: 2 } }] });
    });
  });
});
