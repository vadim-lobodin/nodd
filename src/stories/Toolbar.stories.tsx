import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Chat, Layers } from '@carbon/icons-react';

function Toolbar({ hasVariants = true }: { hasVariants?: boolean }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <div className={`nodd-toolbar${sidebarOpen ? ' nodd-toolbar--shifted' : ''}`}>
      {hasVariants && (
        <button
          className="nodd-btn nodd-btn--sidebar nodd-btn--variants"
          aria-label="Variants"
        >
          <Layers size={20} />
        </button>
      )}
      <button
        className="nodd-btn nodd-btn--sidebar"
        onClick={() => setSidebarOpen(s => !s)}
        aria-label="Open comments"
      >
        <Chat size={20} />
      </button>
    </div>
  );
}

const meta: Meta<typeof Toolbar> = {
  title: 'Nodd/Toolbar',
  component: Toolbar,
};
export default meta;
type Story = StoryObj<typeof Toolbar>;

export const Default: Story = {};
export const NoVariants: Story = {
  args: { hasVariants: false },
};
