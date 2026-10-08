import { API_ERROR_CODES, SUPPORTED_LOCALES, USER_ROLES, VALIDATION_MESSAGES } from '@cpvts/shared';
import { describe, expect, it } from 'vitest';

import { LANGUAGES } from './languages';
import { resources } from './resources';

type Tree = { [key: string]: string | Tree };

const flatten = (tree: Tree, prefix = ''): Record<string, string> =>
  Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string'
      ? { ...acc, [path]: value }
      : { ...acc, ...flatten(value, path) };
  }, {});

const placeholders = (text: string) =>
  [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

const english = flatten(resources.en.translation);

describe('translation catalogues', () => {
  it('provide exactly the four supported languages', () => {
    expect(Object.keys(resources).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    expect(LANGUAGES.map((lang) => lang.code).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it.each(SUPPORTED_LOCALES.filter((locale) => locale !== 'en'))(
    '%s has the same keys and placeholders as English, with no empty values',
    (locale) => {
      const catalogue = flatten(resources[locale].translation);
      expect(Object.keys(catalogue).sort()).toEqual(Object.keys(english).sort());
      for (const [key, value] of Object.entries(catalogue)) {
        expect(value.trim(), key).not.toBe('');
        expect(placeholders(value), key).toEqual(placeholders(english[key] ?? ''));
      }
    },
  );

  it('translate every shared validation message, API error code and role', () => {
    const required = [
      ...Object.values(VALIDATION_MESSAGES),
      ...API_ERROR_CODES.map((code) => `errors.${code}`),
      ...USER_ROLES.map((role) => `roles.${role}`),
    ];
    for (const key of required) expect(english, key).toHaveProperty([key]);
  });
});
