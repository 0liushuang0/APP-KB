interface FormTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  helper?: string
  error?: string
  required?: boolean
}

export default function FormTextarea({ label, helper, error, className = '', required, ...props }: FormTextareaProps) {
  return (
    <div className={className}>
      {label && (
        <label className="block eo-label mb-1.5">
          {label}
          {required && <span className="text-accent-500 ml-0.5">*</span>}
        </label>
      )}
      <textarea
        className={`eo-input resize-y ${error ? '!border-danger-fg !ring-danger-fg/20' : ''}`}
        {...props}
        required={required}
      />
      {error && <p className="mt-1 text-xs text-danger-fg">{error}</p>}
      {helper && !error && <p className="mt-1 text-xs text-muted">{helper}</p>}
    </div>
  )
}
