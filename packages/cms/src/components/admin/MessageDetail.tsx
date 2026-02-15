'use client';

import React, { useEffect, useState } from 'react';
import { useDocumentInfo } from '@payloadcms/ui';

const subjectLabels: Record<string, string> = {
  repair: 'Repair Quote',
  rental: 'Rental Question',
  general: 'General Inquiry',
  other: 'Something Else',
};

interface MessageData {
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
  createdAt: string;
}

const MessageDetail: React.FC = () => {
  const { id } = useDocumentInfo();
  const [data, setData] = useState<MessageData | null>(null);

  useEffect(() => {
    if (id) {
      fetch(`/api/messages/${id}`, { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : null))
        .then(setData)
        .catch(() => {});
    }
  }, [id]);

  if (!data) return null;

  const formattedDate = data.createdAt
    ? new Date(data.createdAt).toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';

  return (
    <div className="message-detail">
      <div className="message-detail__header">
        <div>
          <div className="message-detail__name">{data.name}</div>
          <span className="message-detail__badge">
            {subjectLabels[data.subject] || data.subject}
          </span>
        </div>
        <div className="message-detail__date">{formattedDate}</div>
      </div>

      <div className="message-detail__actions">
        {data.email && (
          <a href={`mailto:${data.email}`} className="message-detail__link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            Reply to {data.email}
          </a>
        )}
        {data.phone && (
          <a href={`tel:${data.phone}`} className="message-detail__link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
            Call {data.phone}
          </a>
        )}
      </div>

      <div className="message-detail__body">{data.message}</div>
    </div>
  );
};

export default MessageDetail;
