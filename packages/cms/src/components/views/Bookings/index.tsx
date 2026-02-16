import React from 'react'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { BookingsClient } from './BookingsClient'

// Payload v3 passes serverProps to custom views via RenderServerComponent.
// For custom root views (not overriding built-ins), templateType is undefined,
// so Payload renders the view WITHOUT the admin shell. We must wrap in
// DefaultTemplate ourselves to get the nav sidebar.
// Key: visibleEntities lives inside initPageResult, not at the top level.
export const BookingsView = async (props: any) => {
  const { initPageResult, params, payload, searchParams } = props
  const { locale, permissions, req, visibleEntities } = initPageResult || {}

  return (
    <DefaultTemplate
      i18n={req?.i18n}
      locale={locale}
      params={params}
      payload={payload}
      permissions={permissions}
      req={req}
      searchParams={searchParams}
      user={req?.user}
      visibleEntities={visibleEntities || { collections: [], globals: [] }}
    >
      <BookingsClient apiUrl={process.env.EXPRESS_API_URL || 'http://localhost:3001'} />
    </DefaultTemplate>
  )
}
