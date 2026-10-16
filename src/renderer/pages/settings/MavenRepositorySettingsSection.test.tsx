// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Button, Form } from 'antd';
import { afterEach, expect, it, vi } from 'vitest';
import { MavenRepositorySettingsSection } from './MavenRepositorySettingsSection';
import { normalizeSettingsFormValues } from './settings-form-utils';

afterEach(cleanup);

it('adds, validates, saves and removes repository URLs through the settings form', async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }),
  });
  const save = vi.fn();
  render(
    <Form
      initialValues={{ mavenRepositories: ['https://old.example.com'] }}
      onFinish={(values) => save(normalizeSettingsFormValues(values))}
    >
      <MavenRepositorySettingsSection />
      <Button htmlType="submit">설정 저장</Button>
    </Form>
  );
  fireEvent.click(screen.getByRole('button', { name: '저장소 추가' }));
  fireEvent.change(screen.getByLabelText('Maven 저장소 URL 2'), {
    target: { value: 'file:///tmp/repo' },
  });
  fireEvent.click(screen.getByRole('button', { name: '설정 저장' }));
  await screen.findByText(/HTTP\(S\) URL이어야/);
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Maven 저장소 URL 2'), {
    target: { value: ' https://new.example.com/releases/ ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Maven 저장소 1 삭제' }));
  fireEvent.click(screen.getByRole('button', { name: '설정 저장' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({ mavenRepositories: ['https://new.example.com/releases'] })
  );
});
