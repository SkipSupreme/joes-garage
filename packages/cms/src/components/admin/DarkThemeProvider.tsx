'use client'

import React, { useEffect } from 'react'
import { useTheme } from '@payloadcms/ui'

const DarkThemeProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { setTheme } = useTheme()

  useEffect(() => {
    setTheme('dark')
  }, [setTheme])

  return <>{children}</>
}

export default DarkThemeProvider
