'use client'
import React, { useState, useMemo } from 'react'

interface CalendarPickerProps {
  value: string          // YYYY-MM-DD or ''
  onChange: (date: string) => void
  minDate?: string       // YYYY-MM-DD
  label?: string
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function formatDisplayDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00')
  return d.toLocaleDateString('en-CA', {
    timeZone: 'America/Edmonton',
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export const CalendarPicker: React.FC<CalendarPickerProps> = ({
  value,
  onChange,
  minDate,
  label,
}) => {
  // Calendar is open when no date selected, or user clicks to change
  const [open, setOpen] = useState(!value)

  // Start viewing the month of the selected date, or today
  const initial = value ? new Date(value + 'T00:00') : new Date()
  const [viewYear, setViewYear] = useState(initial.getFullYear())
  const [viewMonth, setViewMonth] = useState(initial.getMonth())

  const minDateObj = minDate ? new Date(minDate + 'T00:00') : null

  const days = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1)
    const startDay = first.getDay()
    const lastDate = new Date(viewYear, viewMonth + 1, 0).getDate()

    const cells: Array<{ date: number; dateStr: string; disabled: boolean; today: boolean } | null> = []

    for (let i = 0; i < startDay; i++) {
      cells.push(null)
    }

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' })

    for (let d = 1; d <= lastDate; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const dateObj = new Date(dateStr + 'T00:00')
      const disabled = minDateObj ? dateObj < minDateObj : false
      cells.push({ date: d, dateStr, disabled, today: dateStr === todayStr })
    }

    return cells
  }, [viewYear, viewMonth, minDate])

  const goBack = () => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear(viewYear - 1)
    } else {
      setViewMonth(viewMonth - 1)
    }
  }

  const goForward = () => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear(viewYear + 1)
    } else {
      setViewMonth(viewMonth + 1)
    }
  }

  const handleSelect = (dateStr: string) => {
    onChange(dateStr)
    setOpen(false)
  }

  const handleFieldClick = () => {
    // Jump calendar view to the selected date's month
    if (value) {
      const d = new Date(value + 'T00:00')
      setViewYear(d.getFullYear())
      setViewMonth(d.getMonth())
    }
    setOpen(true)
  }

  return (
    <div className="cal-picker">
      {label && <label className="walk-in-modal__label">{label}</label>}

      {/* Collapsed state: show selected date as a filled field */}
      {!open && value && (
        <button
          type="button"
          className="cal-picker__field"
          onClick={handleFieldClick}
        >
          <svg className="cal-picker__field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span className="cal-picker__field-text">{formatDisplayDate(value)}</span>
          <span className="cal-picker__field-change">Change</span>
        </button>
      )}

      {/* Expanded state: full calendar */}
      {open && (
        <div className="cal-picker__container">
          <div className="cal-picker__header">
            <button
              className="cal-picker__nav-btn"
              onClick={goBack}
              type="button"
              aria-label="Previous month"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span className="cal-picker__month-label">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button
              className="cal-picker__nav-btn"
              onClick={goForward}
              type="button"
              aria-label="Next month"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          <div className="cal-picker__weekdays">
            {WEEKDAYS.map((wd) => (
              <span key={wd} className="cal-picker__weekday">{wd}</span>
            ))}
          </div>

          <div className="cal-picker__grid">
            {days.map((cell, i) =>
              cell === null ? (
                <span key={`blank-${i}`} className="cal-picker__blank" />
              ) : (
                <button
                  key={cell.dateStr}
                  type="button"
                  disabled={cell.disabled}
                  className={[
                    'cal-picker__day',
                    value === cell.dateStr ? 'cal-picker__day--selected' : '',
                    cell.today ? 'cal-picker__day--today' : '',
                  ].join(' ')}
                  onClick={() => !cell.disabled && handleSelect(cell.dateStr)}
                >
                  {cell.date}
                </button>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  )
}
