import React from 'react';
import type { Preview, Decorator } from '@storybook/react-vite';
import '../src/overlay/styles/overlay.css';
import './story-reset.css';

const withNoddRoot: Decorator = (Story, context) => {
  const bgValue = context.globals?.backgrounds?.value;
  const theme = bgValue === '#1a1a1a' ? 'dark' : 'light';
  return (
    <div data-nodd-root data-nodd-story data-nodd-theme={theme} style={{ padding: 32 }}>
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withNoddRoot],
  parameters: {
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#f5f5f5' },
        { name: 'dark', value: '#1a1a1a' },
      ],
    },
  },
};

export default preview;
