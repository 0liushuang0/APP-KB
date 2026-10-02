import { useMemo, useState } from 'react'

export const required = (message = '必填') => (value: any) =>
  value === undefined || value === null || value === '' ? message : undefined

export const pattern = (regex: RegExp, message = '格式不正确') => (value: any) =>
  !value || regex.test(value) ? undefined : message

export const minLength = (min: number, message?: string) => (value: any) =>
  !value || String(value).length >= min ? undefined : message || `至少${min}个字符`

export const maxLength = (max: number, message?: string) => (value: any) =>
  !value || String(value).length <= max ? undefined : message || `最多${max}个字符`

interface UseFormValidationOptions<T> {
  initialValues: T
  rules: Partial<Record<keyof T, (value: any, values: T) => string | undefined>>
}

export function useFormValidation<T extends Record<string, any>>({ initialValues, rules }: UseFormValidationOptions<T>) {
  const [values, setValues] = useState<T>(initialValues)
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({})
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({})

  const isValid = useMemo(() => {
    return (Object.keys(rules) as (keyof T)[]).every((key) => {
      const rule = rules[key]
      if (!rule) return true
      return !rule(values[key], values)
    })
  }, [rules, values])

  const setValue = (key: keyof T, value: any) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    if (touched[key]) {
      validateField(key, value)
    }
  }

  const validateField = (key: keyof T, value: any) => {
    const rule = rules[key]
    if (!rule) return true
    const error = rule(value, values)
    setErrors((prev) => ({ ...prev, [key]: error }))
    return !error
  }

  const validateAll = (): boolean => {
    const newErrors: Partial<Record<keyof T, string>> = {}
    let valid = true
    for (const key of Object.keys(rules) as (keyof T)[]) {
      const error = rules[key]?.(values[key], values)
      if (error) {
        newErrors[key] = error
        valid = false
      }
    }
    setErrors(newErrors)
    setTouched(Object.keys(rules).reduce((acc, key) => ({ ...acc, [key]: true }), {}))
    return valid
  }

  const reset = () => {
    setValues(initialValues)
    setErrors({})
    setTouched({})
  }

  return {
    values,
    errors,
    touched,
    isValid,
    setValue,
    setValues,
    validateField,
    validateAll,
    reset,
  }
}
