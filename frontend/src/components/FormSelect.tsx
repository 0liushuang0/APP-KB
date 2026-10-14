interface Option {
  value: string
  label: string
}

interface FormSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: Option[]
  helper?: string
  error?: string
  required?: boolean
}

export default function FormSelect({ label, options, helper, error, className = '', required, ...props }: FormSelectProps) {
  return (
    <div className={className}>
      {label && (
        <label className="block eo-label mb-1.5">
          {label}
          {required && <span className="text-accent-500 ml-0.5">*</span>}
        </label>
      )}
      <select
        className={`eo-input ${error ? '!border-danger-fg !ring-danger-fg/20' : ''}`}
        {...props}
        required={required}
      >
        {/* 受控且当前值为空、选项里又没有空值时补占位项: 否则浏览器会显示第一项, 看起来已选但表单值仍是空
            (必填校验不过, 确认按钮一直灰着, 用户还看不出哪里没选) */}
        {props.value === '' && !options.some((o) => o.value === '') && (
          <option value="" disabled={required}>
            请选择
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-danger-fg">{error}</p>}
      {helper && !error && <p className="mt-1 text-xs text-muted">{helper}</p>}
    </div>
  )
}
