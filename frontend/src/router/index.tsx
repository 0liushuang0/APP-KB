import { useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import apiClient from '../api/client'
import { useAuthStore } from '../store/authStore'
import Layout from '../components/Layout'
import PageLoader from '../components/PageLoader'

// 路由懒加载：首屏只加载当前页面，其余按需加载
const Login = lazy(() => import('../pages/Login'))
const PrivacyPolicy = lazy(() => import('../pages/PrivacyPolicy'))
const TermsOfService = lazy(() => import('../pages/TermsOfService'))
const WorkflowWorkbench = lazy(() => import('../pages/WorkflowWorkbench'))
const AIAssistant = lazy(() => import('../pages/AIAssistant'))
const Approvals = lazy(() => import('../pages/Approvals'))
const WorkTasks = lazy(() => import('../pages/WorkTasks'))
const Settings = lazy(() => import('../pages/Settings'))
const SecuritySettings = lazy(() => import('../pages/settings/Security'))
const SystemInfo = lazy(() => import('../pages/settings/SystemInfo'))
const SystemConfigPage = lazy(() => import('../pages/settings/SystemConfigPage'))
const AiConfig = lazy(() => import('../pages/settings/AiConfig'))
const BackupRestore = lazy(() => import('../pages/settings/BackupRestore'))
const RecycleBin = lazy(() => import('../pages/settings/RecycleBin'))
const NumberingRules = lazy(() => import('../pages/settings/NumberingRules'))
const PerformanceMetrics = lazy(() => import('../pages/settings/PerformanceMetrics'))
const RegionDictionary = lazy(() => import('../pages/settings/RegionDictionary'))
const Customers = lazy(() => import('../pages/Customers'))
const Customer360 = lazy(() => import('../pages/Customer360'))
const Requirements = lazy(() => import('../pages/Requirements'))
const RequirementDetail = lazy(() => import('../pages/RequirementDetail'))
const Proposals = lazy(() => import('../pages/Proposals'))
const Quotations = lazy(() => import('../pages/Quotations'))
const Contracts = lazy(() => import('../pages/Contracts'))
const AfterSales = lazy(() => import('../pages/AfterSales'))
const Products = lazy(() => import('../pages/Products'))
const ProductTree = lazy(() => import('../pages/ProductTree'))
const SupplyTabs = lazy(() => import('../pages/SupplyTabs'))
const CalcTools = lazy(() => import('../pages/CalcTools'))
const Projects = lazy(() => import('../pages/Projects'))
const ProjectCompletionReport = lazy(() => import('../pages/ProjectCompletionReport'))
const Documents = lazy(() => import('../pages/Documents'))
const CustomerDocs = lazy(() => import('../pages/CustomerDocs'))
const KnowledgeBase = lazy(() => import('../pages/KnowledgeBase'))
const Solutions = lazy(() => import('../pages/Solutions'))
const ParamTemplates = lazy(() => import('../pages/ParamTemplates'))
const AuditLogs = lazy(() => import('../pages/AuditLogs'))
const BudgetConfig = lazy(() => import('../pages/settings/BudgetConfig'))
const HelpCenter = lazy(() => import('../pages/HelpCenter'))
const Notifications = lazy(() => import('../pages/Notifications'))
const WeeklyReport = lazy(() => import('../pages/WeeklyReport'))

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

/**
 * 管理员路由守卫。
 * 之前 ProtectedRoute 只判登录态，team 模式下任何登录用户都能进
 * settings/users、roles、audit 等管理页（点了才被后端 403 拒绝，体验差）。
 * 现在：
 *   · single 模式：自动以管理员登录，直接放行
 *   · team 模式：要求 admin 角色，否则跳回工作台
 */
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, hasRole, appMode } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  // single 模式无 RBAC，登录即管理员
  const ok = appMode === 'single' || hasRole('admin')
  return ok ? <>{children}</> : <Navigate to="/" replace />
}

/** 系统信息接口返回类型（之前 inline 用 any，这里补类型） */
interface SystemInfoResponse {
  mode?: 'single' | 'team'
  version?: string
}

export default function AppRouter() {
  const { setAppMode } = useAuthStore()

  const { data: systemInfo } = useQuery({
    queryKey: ['system-info'],
    queryFn: async () => {
      const res = await apiClient.get<SystemInfoResponse>('/system/info')
      return res.data
    },
  })

  useEffect(() => {
    if (systemInfo?.mode) {
      setAppMode(systemInfo.mode)
    }
  }, [systemInfo, setAppMode])

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          {/* 工作台 */}
          <Route index element={<WorkflowWorkbench />} />
          <Route path="workbench" element={<WorkflowWorkbench />} />
          <Route path="work-tasks" element={<WorkTasks />} />

          {/* 业务管理 */}
          <Route path="customers" element={<Customers />} />
          <Route path="customers/:id" element={<Customer360 />} />
          <Route path="requirements" element={<Requirements />} />
          <Route path="requirements/:id" element={<RequirementDetail />} />
          <Route path="proposals" element={<Proposals />} />
          <Route path="quotations" element={<Quotations />} />
          <Route path="contracts" element={<Contracts />} />
          <Route path="after-sales" element={<AfterSales />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:id/report" element={<ProjectCompletionReport />} />

          {/* 知识中心 */}
          {/* 业务资料 = 对外宣传、客户无关的独立资料库（scope=business：无任何单据关联的文档） */}
          <Route path="documents" element={<Documents fixedScope="business" />} />
          <Route path="customer-docs" element={<CustomerDocs />} />
          <Route path="knowledge" element={<KnowledgeBase />} />
          <Route path="solutions" element={<Solutions />} />
          <Route path="suppliers" element={<SupplyTabs />} />
          <Route path="calc-tools" element={<CalcTools />} />
          <Route path="calc-tools/:code" element={<CalcTools />} />
          <Route path="ai-assistant" element={<AIAssistant />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="help" element={<HelpCenter />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="reports/weekly" element={<WeeklyReport />} />

          {/* 产品管理 */}
          <Route path="products" element={<Products />} />
          <Route path="products/tree" element={<ProductTree />} />
          <Route path="param-templates" element={<ParamTemplates />} />

          {/* 系统设置 */}
          <Route path="settings" element={<Settings />}>
            <Route index element={<SystemInfo />} />
            <Route path="security" element={<SecuritySettings />} />
            <Route path="config" element={<RequireAdmin><SystemConfigPage /></RequireAdmin>} />
            <Route path="ai" element={<RequireAdmin><AiConfig /></RequireAdmin>} />
            <Route path="budget" element={<RequireAdmin><BudgetConfig /></RequireAdmin>} />
            {/*
              回收站不加 RequireAdmin：还原/彻底删除走的是 /documents/recycle/*，
              后端本来就对普通用户开放（业务资料页那个抽屉人人能用）。
              这里再拦一道，等于把已有能力从普通用户手里拿走。
            */}
            <Route path="recycle-bin" element={<RecycleBin />} />
            <Route path="backup" element={<RequireAdmin><BackupRestore /></RequireAdmin>} />
            <Route path="numbering" element={<RequireAdmin><NumberingRules /></RequireAdmin>} />
            <Route path="regions" element={<RequireAdmin><RegionDictionary /></RequireAdmin>} />
            <Route path="audit" element={<RequireAdmin><AuditLogs /></RequireAdmin>} />
            <Route path="metrics" element={<RequireAdmin><PerformanceMetrics /></RequireAdmin>} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
