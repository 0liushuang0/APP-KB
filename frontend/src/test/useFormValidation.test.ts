import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFormValidation, required, minLength, maxLength, pattern } from '../hooks/useFormValidation'

describe('useFormValidation', () => {
  it('required field validation', () => {
    const { result } = renderHook(() =>
      useFormValidation({
        initialValues: { name: '' },
        rules: { name: required('Name is required') },
      }),
    )

    // Initially isValid should be false (empty required field)
    expect(result.current.isValid).toBe(false)

    // Set a value
    act(() => {
      result.current.setValue('name', 'Alice')
    })

    expect(result.current.values.name).toBe('Alice')
    expect(result.current.errors.name).toBeUndefined()
  })

  it('custom validators', () => {
    const { result } = renderHook(() =>
      useFormValidation({
        initialValues: { email: '' },
        rules: {
          email: pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email'),
        },
      }),
    )

    act(() => {
      result.current.setValue('email', 'not-an-email')
    })
    // Not touched yet, so no error
    expect(result.current.errors.email).toBeUndefined()

    // validateAll marks all fields as touched and validates
    act(() => {
      result.current.validateAll()
    })
    expect(result.current.errors.email).toBe('Invalid email')
    expect(result.current.touched.email).toBe(true)
  })

  it('validateAll returns false when errors exist', () => {
    const { result } = renderHook(() =>
      useFormValidation({
        initialValues: { name: '', age: '' },
        rules: {
          name: required('Required'),
          age: required('Age required'),
        },
      }),
    )

    act(() => {
      result.current.validateAll()
    })

    expect(result.current.errors.name).toBe('Required')
    expect(result.current.errors.age).toBe('Age required')
    expect(result.current.touched.name).toBe(true)
    expect(result.current.touched.age).toBe(true)
  })

  it('validateAll returns true when all fields pass', () => {
    const { result } = renderHook(() =>
      useFormValidation({
        initialValues: { name: 'Alice' },
        rules: { name: required() },
      }),
    )

    act(() => {
      result.current.validateAll()
    })

    expect(result.current.errors.name).toBeUndefined()
    expect(result.current.touched.name).toBe(true)
  })

  it('clearErrors via reset', () => {
    const { result } = renderHook(() =>
      useFormValidation({
        initialValues: { name: '' },
        rules: { name: required() },
      }),
    )

    // Create errors
    act(() => {
      result.current.validateAll()
    })
    expect(result.current.errors.name).toBe('必填')

    // Reset clears errors and touched
    act(() => {
      result.current.reset()
    })

    expect(result.current.errors.name).toBeUndefined()
    expect(result.current.touched.name).toBeUndefined()
    expect(result.current.values.name).toBe('')
  })

  it('minLength validator', () => {
    const { result } = renderHook(() =>
      useFormValidation({
        initialValues: { pw: '' },
        rules: { pw: minLength(8, 'Too short') },
      }),
    )

    act(() => {
      result.current.setValue('pw', 'abc')
      result.current.validateField('pw', 'abc')
    })

    expect(result.current.errors.pw).toBe('Too short')

    act(() => {
      result.current.setValue('pw', 'abcdefgh')
      result.current.validateField('pw', 'abcdefgh')
    })

    expect(result.current.errors.pw).toBeUndefined()
  })

  it('maxLength validator', () => {
    const { result } = renderHook(() =>
      useFormValidation({
        initialValues: { note: '' },
        rules: { note: maxLength(5) },
      }),
    )

    act(() => {
      result.current.setValue('note', '123456')
      result.current.validateField('note', '123456')
    })

    expect(result.current.errors.note).toBe('最多5个字符')
  })
})
