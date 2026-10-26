import { describe, expect, it } from 'vitest';
import { assertSupportedNodeVersion } from './version';

describe('CLI security runtime policy', () => {
  it.each(['22.23.4', '22.23.5', '24.22.1', '24.22.2'])(
    'accepts patched supported Node %s',
    (version) => {
      expect(() => assertSupportedNodeVersion(version)).not.toThrow();
    }
  );

  it.each(['22.13.0', '22.23.3', '24.0.0', '24.22.0', '25.6.0', '26.12.1', '24.22.1-rc.1'])(
    'rejects unsafe or unvalidated Node %s',
    (version) => {
      expect(() => assertSupportedNodeVersion(version)).toThrow('보안 패치');
    }
  );
});
