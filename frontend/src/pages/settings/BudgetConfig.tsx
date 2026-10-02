import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DollarSign, AlertTriangle, CheckCircle, Save } from 'lucide-react'
import { toast } from 'sonner'
import apiClient from '../../api/client'

interface BudgetData {
  id?: string
  monthlyLimit: number
  currentUsage: number
  alertThreshold: number
  period: string
  isActive: boolean
}

interface BudgetStatus {
  allowed: boolean
  usage: number
  limit: number
  percentage: number
  alertLevel: 'none' | 'warning' | 'critical'
}

export default function BudgetConfig() {
  const queryClient = useQueryClient()
  const [monthlyLimit, setMonthlyLimit] = useState('')
  const [alertThreshold, setAlertThreshold] = useState('80')

  const { data: budget, isLoading } = useQuery<BudgetData>({
    queryKey: ['ai-budget'],
    queryFn: async () => {
      const res: any = await apiClient.get('/ai-budget')
      return res.data
    },
  })

  const { data: status } = useQuery<BudgetStatus>({
    queryKey: ['ai-budget-status'],
    queryFn: async () => {
      const res: any = await apiClient.get('/ai-budget/status')
      return res.data
    },
  })

  useEffect(() => {
    if (budget) {
      setMonthlyLimit(budget.monthlyLimit?.toString() || '')
      setAlertThreshold(((budget.alertThreshold || 0.8) * 100).toString())
    }
  }, [budget])

  const updateMutation = useMutation({
    mutationFn: async (data: { monthlyLimit: number }) => {
      await apiClient.put('/ai-budget', data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-budget'] })
      queryClient.invalidateQueries({ queryKey: ['ai-budget-status'] })
      toast.success('Budget updated successfully')
    },
    onError: () => {
      toast.error('Failed to update budget')
    },
  })

  const handleSave = () => {
    const limit = parseFloat(monthlyLimit)
    if (isNaN(limit) || limit < 0) {
      toast.error('Please enter a valid budget amount')
      return
    }
    updateMutation.mutate({ monthlyLimit: limit })
  }

  const getAlertColor = (level: string) => {
    switch (level) {
      case 'critical':
        return 'text-danger-600 bg-danger-50 border-danger-200'
      case 'warning':
        return 'text-warning-600 bg-warning-50 border-warning-200'
      default:
        return 'text-success-600 bg-success-50 border-success-200'
    }
  }

  const getProgressColor = (percentage: number) => {
    if (percentage >= 1) return 'bg-danger-500'
    if (percentage >= 0.8) return 'bg-warning-500'
    return 'bg-success-500'
  }

  if (isLoading) {
    return <div className="animate-pulse h-64 bg-subtle rounded-lg" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center">
          <DollarSign size={20} className="text-primary-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-ink">AI Usage Budget</h2>
          <p className="text-sm text-ink-soft">Manage your monthly AI usage limits</p>
        </div>
      </div>

      {/* Current Status */}
      {status && (
        <div className={`p-4 rounded-lg border ${getAlertColor(status.alertLevel)}`}>
          <div className="flex items-center gap-3">
            {status.alertLevel === 'critical' ? (
              <AlertTriangle size={20} />
            ) : status.alertLevel === 'warning' ? (
              <AlertTriangle size={20} />
            ) : (
              <CheckCircle size={20} />
            )}
            <div>
              <p className="font-medium">
                {status.alertLevel === 'critical'
                  ? 'Budget exceeded'
                  : status.alertLevel === 'warning'
                  ? 'Approaching budget limit'
                  : 'Within budget'}
              </p>
              <p className="text-sm mt-1">
                ${status.usage.toFixed(2)} of ${status.limit.toFixed(2)} used ({(status.percentage * 100).toFixed(1)}%)
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Usage Progress */}
      {status && status.limit > 0 && (
        <div className="bg-surface p-4 rounded-lg border border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-ink">Monthly Usage</span>
            <span className="text-sm text-ink-soft">
              ${(status?.usage || 0).toFixed(2)} / ${(status?.limit || 0).toFixed(2)}
            </span>
          </div>
          <div className="w-full bg-border rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${getProgressColor(status?.percentage || 0)}`}
              style={{ width: `${Math.min((status?.percentage || 0) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Budget Settings */}
      <div className="bg-surface p-6 rounded-lg border border-border">
        <h3 className="text-md font-medium text-ink mb-4">Budget Settings</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              Monthly Budget Limit ($)
            </label>
            <input
              type="number"
              value={monthlyLimit}
              onChange={(e) => setMonthlyLimit(e.target.value)}
              placeholder="Enter monthly budget limit"
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              min="0"
              step="0.01"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              Alert Threshold (%)
            </label>
            <input
              type="number"
              value={alertThreshold}
              onChange={(e) => setAlertThreshold(e.target.value)}
              placeholder="Enter alert threshold percentage"
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              min="0"
              max="100"
            />
            <p className="text-xs text-ink-soft mt-1">
              You will be notified when usage reaches this percentage of your budget
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isActive"
              checked={budget?.isActive ?? true}
              onChange={() => {}}
              className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-border rounded"
            />
            <label htmlFor="isActive" className="text-sm text-ink">
              Enable budget tracking
            </label>
          </div>

          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
          >
            <Save size={16} />
            {updateMutation.isPending ? 'Saving...' : 'Save Budget'}
          </button>
        </div>
      </div>

      {/* Usage History */}
      <div className="bg-surface p-6 rounded-lg border border-border">
        <h3 className="text-md font-medium text-ink mb-4">Current Period</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-subtle rounded-lg">
            <p className="text-sm text-ink-soft">Period</p>
            <p className="text-lg font-semibold text-ink">{budget?.period || 'N/A'}</p>
          </div>
          <div className="p-4 bg-subtle rounded-lg">
            <p className="text-sm text-ink-soft">Usage</p>
            <p className="text-lg font-semibold text-ink">
              ${(budget?.currentUsage || 0).toFixed(2)}
            </p>
          </div>
          <div className="p-4 bg-subtle rounded-lg">
            <p className="text-sm text-ink-soft">Limit</p>
            <p className="text-lg font-semibold text-ink">
              ${(budget?.monthlyLimit || 0).toFixed(2)}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}