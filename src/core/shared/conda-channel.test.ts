import { describe, expect, it } from 'vitest';
import { getCondaApiOwner, getCondaRepositoryBase } from './conda-channel';

describe('Conda channel URL boundaries', () => {
  it.each([
    ['defaults', 'https://repo.anaconda.com/pkgs/main'],
    ['main', 'https://conda.anaconda.org/main'],
    ['conda-forge', 'https://conda.anaconda.org/conda-forge'],
    ['anaconda', 'https://conda.anaconda.org/anaconda'],
    ['custom-channel', 'https://conda.anaconda.org/custom-channel'],
  ])('maps the standard %s channel to %s', (channel, expected) => {
    expect(getCondaRepositoryBase(channel)).toBe(expected);
  });

  it('keeps defaults on a custom origin instead of applying the official alias', () => {
    expect(getCondaRepositoryBase('defaults', 'https://mirror.example/conda/')).toBe(
      'https://mirror.example/conda/defaults'
    );
    expect(getCondaRepositoryBase('main', 'https://mirror.example/conda/')).toBe(
      'https://mirror.example/conda/main'
    );
  });

  it.each([
    ['defaults', 'main'],
    ['main', 'main'],
    ['conda-forge', 'conda-forge'],
  ])('uses %s as the Anaconda API owner %s', (channel, expected) => {
    expect(getCondaApiOwner(channel)).toBe(expected);
  });
});
