import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Add, Menu } from '@carbon/icons-react';

function Toolbar() {
  const [capturing, setCapturing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <div className={`nodd-toolbar${sidebarOpen ? ' nodd-toolbar--shifted' : ''}`}>
      <button
        className={`nodd-btn nodd-btn--capture${capturing ? ' nodd-btn--active' : ''}`}
        onClick={() => setCapturing(c => !c)}
        aria-label="Add comment"
      >
        <Add size={20} />
      </button>
      <button
        className="nodd-btn nodd-btn--sidebar"
        onClick={() => setSidebarOpen(s => !s)}
        aria-label="Open comments"
      >
        <Menu size={20} />
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
export const CaptureActive: Story = {
  render: () => (
    <div className="nodd-toolbar">
      <button className="nodd-btn nodd-btn--capture nodd-btn--active" aria-label="Add comment">
        <Add size={20} />
      </button>
      <button className="nodd-btn nodd-btn--sidebar" aria-label="Open comments">
        <Menu size={20} />
      </button>
    </div>
  ),
};
