import React from 'react'
import { BookingsClient } from './BookingsClient'

export const BookingsView: React.FC = () => {
  return <BookingsClient apiUrl={process.env.EXPRESS_API_URL || 'http://localhost:3001'} />
}
