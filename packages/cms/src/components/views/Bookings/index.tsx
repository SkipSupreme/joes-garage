import React from 'react'
import type { ServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { BookingsClient } from './BookingsClient'

export const BookingsView: React.FC<ServerProps> = async ({
  i18n,
  locale,
  params,
  payload,
  permissions,
  searchParams,
  user,
  visibleEntities,
}) => {
  return (
    <DefaultTemplate
      i18n={i18n}
      locale={locale}
      params={params}
      payload={payload}
      permissions={permissions}
      searchParams={searchParams}
      user={user}
      visibleEntities={visibleEntities!}
    >
      <BookingsClient apiUrl={process.env.EXPRESS_API_URL || 'http://localhost:3001'} />
    </DefaultTemplate>
  )
}
