import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { VariantSelector } from '../overlay/components/VariantSelector';

function VariantSelectorPreview() {
  const [value, setValue] = useState('Minimal');

  return (
    <div style={{ width: 360 }}>
      <VariantSelector
        label="Hero layout"
        options={['Minimal', 'Bold']}
        value={value}
        onValueChange={setValue}
      />
    </div>
  );
}

const meta: Meta<typeof VariantSelectorPreview> = {
  title: 'Nodd/Components/Variant Selector',
  component: VariantSelectorPreview,
};

export default meta;
type Story = StoryObj<typeof VariantSelectorPreview>;

export const Default: Story = {};
