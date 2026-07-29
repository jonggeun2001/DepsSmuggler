import { describe, expect, it } from 'vitest';
import { evaluatePep508Marker } from './pep508-marker';

describe('evaluatePep508Marker', () => {
  it.each([
    ['Foo.Bar', 'foo-bar'],
    ['foo_bar', 'foo-bar'],
    ['foo-bar', 'Foo.Bar'],
  ])(
    'PEP 685 extra 이름 %s와 %s를 동등하게 비교한다',
    (selectedExtra, markerExtra) => {
      expect(
        evaluatePep508Marker(
          `extra == "${markerExtra}"`,
          { extra: selectedExtra },
        ),
      ).toBe(true);
    },
  );

  it('extra의 ===에는 PEP 685 정규화를 적용한다', () => {
    expect(
      evaluatePep508Marker(
        'extra === "foo-bar"',
        { extra: 'Foo.Bar' },
      ),
    ).toBe(true);
  });

  it('platform_machine의 ===는 별칭을 정규화하지 않는다', () => {
    expect(
      evaluatePep508Marker(
        'platform_machine === "AMD64"',
        { platform_machine: 'x86_64' },
      ),
    ).toBe(false);
  });

  it('===는 버전을 정규화하지 않고 원문 문자열로 비교한다', () => {
    expect(
      evaluatePep508Marker(
        'python_version === "3.12.0"',
        { python_version: '3.12' },
      ),
    ).toBe(false);
    expect(
      evaluatePep508Marker(
        'python_version === "3.12"',
        { python_version: '3.12' },
      ),
    ).toBe(true);
  });

  it('===는 버전 문자열의 ASCII 대소문자를 구분하지 않는다', () => {
    expect(
      evaluatePep508Marker(
        'implementation_version === "3.12rc1"',
        { implementation_version: '3.12RC1' },
      ),
    ).toBe(true);
  });

  it('불완전한 full version의 === 결과는 확정하지 않고 보수적으로 처리한다', () => {
    const marker = 'python_full_version === "3.12.0"';
    const environment = { python_full_version: '3.12' };
    const incompleteVersions = {
      python_full_version: '3.12',
    } as const;

    expect(
      evaluatePep508Marker(marker, environment, {
        incompleteVersions,
        unknownResult: true,
      }),
    ).toBe(true);
    expect(
      evaluatePep508Marker(marker, environment, {
        incompleteVersions,
        unknownResult: false,
      }),
    ).toBe(false);
  });
});
