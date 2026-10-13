import { isPricectlTag, metadataChanges, userMetadata } from '../engine/metadata';

describe('userMetadata', () => {
  it('drops pricectl tags and keeps the rest', () => {
    expect(userMetadata({ team: 'billing', pricectl_stack: 'Shop', pricectl_id: 'P' })).toEqual({ team: 'billing' });
  });

  it('stores values as strings, as Stripe does, and ignores unset (null) values', () => {
    expect(userMetadata({ seats: 5, gone: null })).toEqual({ seats: '5' });
  });

  it('reads nothing as empty', () => {
    expect(userMetadata(undefined)).toEqual({});
    expect(userMetadata(null)).toEqual({});
  });
});

describe('metadataChanges', () => {
  it('returns only the keys that differ', () => {
    expect(metadataChanges({ a: '1', b: '2' }, { a: '1', b: '3' })).toEqual({ b: '3' });
  });

  it('unsets keys that are no longer desired with an empty string', () => {
    expect(metadataChanges({ a: '1', b: '2' }, { a: '1' })).toEqual({ b: '' });
  });

  it('returns nothing when both sides agree', () => {
    expect(metadataChanges({ a: '1' }, { a: '1' })).toEqual({});
  });
});

describe('isPricectlTag', () => {
  it('recognizes the metadata keys pricectl writes itself', () => {
    expect(isPricectlTag('pricectl_stack')).toBe(true);
    expect(isPricectlTag('team')).toBe(false);
  });
});
