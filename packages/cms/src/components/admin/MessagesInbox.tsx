'use client';

import React from 'react';

const MessagesInbox: React.FC = () => {
  return (
    <div
      style={{
        padding: '12px 16px',
        marginBottom: '16px',
        borderRadius: '8px',
        background: 'var(--theme-elevation-100)',
        border: '1px solid var(--theme-elevation-200)',
        fontSize: '13px',
        color: 'var(--theme-elevation-500)',
        lineHeight: '1.5',
      }}
    >
      These messages come from the contact form on your website. Click a name to
      read the full message, then check <strong>Read</strong> when you're done.
      Reply by emailing them directly.
    </div>
  );
};

export default MessagesInbox;
