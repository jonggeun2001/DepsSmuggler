import { expect, it } from 'vitest';
import { MAVEN_CENTRAL_URL, normalizeMavenRepositories } from './maven-repositories';
import { validateSettingsForWrite } from '../core/shared/settings-validation';

it('normalizes whitespace/trailing slashes, removes duplicates and keeps Central implicit', () => {
  expect(
    normalizeMavenRepositories([
      ' https://repo.example.com/releases/ ',
      'https://repo.example.com/releases',
      MAVEN_CENTRAL_URL,
    ])
  ).toEqual(['https://repo.example.com/releases']);
});

it.each([
  null,
  'https://repo.example.com',
  [null],
  [''],
  ['repo.example.com'],
  ['file:///tmp/repo'],
  ['https://user:secret@repo.example.com'],
  ['https://repo.example.com?token=value'],
  ['https://repo.example.com#fragment'],
  ['https://repo.example.com?'],
  ['https://repo.example.com#'],
])('rejects invalid settings in the shared validator and IPC: %j', (value) => {
  expect(() => normalizeMavenRepositories(value)).toThrow();
  expect(validateSettingsForWrite({ mavenRepositories: value })).toHaveProperty('error');
});
