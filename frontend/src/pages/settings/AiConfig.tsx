import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Cpu, Eye, EyeOff, Save, Zap, Database, Server, Wifi, WifiOff, HardDrive, Wrench, Globe } from 'lucide-react'
import { aiConfigApi } from '../../api/services'
import Button from '../../components/Button'
import PageLoader from '../../components/PageLoader'
import ErrorState from '../../components/ErrorState'
import IndexHealthPanel from '../../components/IndexHealthPanel'

type ProviderKey = 'deepseek' | 'glm' | 'openai'

/** 后端 /ai-config 返回的扁平结构：顶层直接是各 provider + rag + embedding。 */
interface AiConfigForm {
  deepseek?: { apiKey?: string; apiKeyRaw?: string; model?: string; baseUrl?: string }
  // GLM 额外带工具调用配置（function calling 用 glm-5.2、web_search 用 glm-4-air）
  glm?: {
    apiKey?: string; apiKeyRaw?: string; model?: string; baseUrl?: string
    toolsEnabled?: boolean; toolModel?: string
    webSearchEnabled?: boolean; webSearchModel?: string; webSearchEngine?: string; webSearchCount?: number
  }
  openai?: { apiKey?: string; apiKeyRaw?: string; model?: string; baseUrl?: string }
  ollama?: { model?: string; baseUrl?: string; status?: string }
  rag?: { chunkSize?: number; chunkOverlap?: number; topK?: number }
  embedding?: { provider?: string; model?: string }
  egress?: { mode?: string; sanitize?: boolean; redactTerms?: string }
  success?: boolean
  message?: string
  _error?: string
  _offline?: boolean
  [key: string]: unknown
}

const PROVIDER_LABELS: Record<ProviderKey, { name: string; desc: string; modules: string; color: string }> = {
  deepseek: { name: 'DeepSeek', desc: '用于报价、文档、产品、需求分析', modules: 'quotation / document / product / default', color: '#4d6bfe' },
  glm: { name: 'GLM / 智谱', desc: '用于方案生成、客户画像', modules: 'proposal / customer', color: '#3b5bfd' },
  openai: { name: 'OpenAI', desc: '可选备用（当前模块路由未使用）', modules: '未启用', color: '#10a37f' },
}

export default function AiConfig() {
  const queryClient = useQueryClient()
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [form, setForm] = useState<AiConfigForm | null>(null)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ai-config'],
    queryFn: () => aiConfigApi.get(),
  })

  useEffect(() => {
    if (data) setForm(data as AiConfigForm)
  }, [data])

  const saveMutation = useMutation({
    mutationFn: (dto: Partial<AiConfigForm>) => aiConfigApi.update(dto),
    onSuccess: (res) => {
      const r = res as AiConfigForm
      if (r?.success === false) {
        toast.warning(r?.message || 'AI 服务未连接，配置未保存')
      } else if (r?._offline) {
        queryClient.invalidateQueries({ queryKey: ['ai-config'] })
        toast.success(r?.message || '配置已保存（AI 服务离线，启动后自动生效）')
      } else {
        queryClient.invalidateQueries({ queryKey: ['ai-config'] })
        toast.success('大模型配置已保存（AI 服务已热重载）')
      }
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { message?: string } } }
      toast.error(err?.response?.data?.message || '保存失败')
    },
  })

  if (isLoading) return <PageLoader />
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />
  if (!form) return null

  const updateProvider = (key: ProviderKey, field: string, value: string) => {
    setForm((prev) => prev ? ({
      ...prev,
      [key]: { ...(prev[key] as Record<string, unknown>), [field]: value },
    }) : prev)
  }

  const updateRag = (field: string, value: unknown) => {
    setForm((prev) => prev ? ({ ...prev, rag: { ...(prev.rag as Record<string, unknown>), [field]: value } }) : prev)
  }

  const updateEmbedding = (field: string, value: string) => {
    setForm((prev) => prev ? ({ ...prev, embedding: { ...(prev.embedding as Record<string, unknown>), [field]: value } }) : prev)
  }

  // GLM 工具调用相关字段（含布尔开关）。注意：布尔值必须直接存 boolean，
  // 不能 String(checked) —— 那会把 "false" 当真值（见 Customers 联系人 isPrimary 的同类缺陷）。
  const updateGlm = (field: string, value: unknown) => {
    setForm((prev) => prev ? ({ ...prev, glm: { ...(prev.glm as Record<string, unknown>), [field]: value } }) : prev)
  }

  const toggleKey = (key: string) => setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }))

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-serif text-heading-lg font-medium text-ink">大模型配置</h2>
        <Button onClick={() => saveMutation.mutate(form)} loading={saveMutation.isPending}>
          <Save size={16} className="mr-2" /> 保存配置
        </Button>
      </div>

        {form._error && (
          <div className="bg-danger-bg border border-danger-line rounded-lg p-4 mb-6 text-sm text-danger-fg">
            {form._error}
        </div>
      )}

      {/* 索引健康度放在模型配置前面：模型配得再好，检索不到数据也答不出来 */}
      <div className="mb-6">
        <IndexHealthPanel />
      </div>

      <div className="space-y-6">
        {(Object.keys(PROVIDER_LABELS) as ProviderKey[]).map((key) => {
          const info = PROVIDER_LABELS[key]
          const cfg = form[key] || {}
          const keyId = `${key}_apiKey`
          return (
            <div key={key} className="eo-card p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${info.color}15` }}>
                  <Cpu size={20} style={{ color: info.color }} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-ink">{info.name}</h3>
                  <p className="text-xs text-muted">{info.desc}</p>
                </div>
                <span className="ml-auto text-xs px-2 py-1 bg-canvas text-muted rounded font-mono">{info.modules}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="eo-label block mb-1.5">API Key</label>
                  <div className="relative">
                    <input
                      type={showKeys[keyId] ? 'text' : 'password'}
                      value={cfg.apiKeyRaw || cfg.apiKey || ''}
                      onChange={(e) => updateProvider(key, 'apiKey', e.target.value)}
                      placeholder="sk-..."
                      className="eo-input w-full pr-9 font-mono text-xs"
                    />
                    <button
                      onClick={() => toggleKey(keyId)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink-soft"
                    >
                      {showKeys[keyId] ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="eo-label block mb-1.5">模型名称</label>
                  <input
                    type="text"
                    value={cfg.model || ''}
                    onChange={(e) => updateProvider(key, 'model', e.target.value)}
                    placeholder="deepseek-chat"
                    className="eo-input w-full"
                  />
                </div>
                <div>
                  <label className="eo-label block mb-1.5">Base URL</label>
                  <input
                    type="text"
                    value={cfg.baseUrl || ''}
                    onChange={(e) => updateProvider(key, 'baseUrl', e.target.value)}
                    placeholder="https://api.example.com/v1"
                    className="eo-input w-full"
                  />
                </div>
              </div>
            </div>
          )
        })}

        {/* GLM 工具调用（GLM-5.2）—— function calling + 内置联网搜索 */}
        <div className="eo-card p-5 border-l-4 border-l-accent-500">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-accent-50 flex items-center justify-center">
              <Wrench size={20} className="text-accent-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">GLM 工具调用（GLM-5.2）</h3>
              <p className="text-xs text-muted">让 AI 主动调本地工具与联网搜索，从"问答"升级为"助手"</p>
            </div>
          </div>

          <div className="space-y-4">
            {/* 两个开关 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex items-center gap-3 eo-card p-3 cursor-pointer hover:border-accent-300">
                <input
                  type="checkbox"
                  checked={!!form.glm?.toolsEnabled}
                  onChange={(e) => updateGlm('toolsEnabled', e.target.checked)}
                  className="w-4 h-4 accent-accent-500"
                />
                <div>
                  <div className="text-sm text-ink font-medium flex items-center gap-1.5"><Wrench size={13} /> 启用工具调用（function calling）</div>
                  <div className="text-xs text-muted">AI 可自主多轮查知识库（客户/需求/方案/报价等）</div>
                </div>
              </label>
              <label className="flex items-center gap-3 eo-card p-3 cursor-pointer hover:border-accent-300">
                <input
                  type="checkbox"
                  checked={!!form.glm?.webSearchEnabled}
                  onChange={(e) => updateGlm('webSearchEnabled', e.target.checked)}
                  className="w-4 h-4 accent-accent-500"
                />
                <div>
                  <div className="text-sm text-ink font-medium flex items-center gap-1.5"><Globe size={13} /> 启用联网搜索（web_search）</div>
                  <div className="text-xs text-muted">答装备询价/型号/行情等需最新外部资料的问题</div>
                </div>
              </label>
            </div>

            {/* 模型与引擎配置 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="eo-label block mb-1.5">工具调用模型</label>
                <input
                  type="text"
                  value={form.glm?.toolModel || ''}
                  onChange={(e) => updateGlm('toolModel', e.target.value)}
                  placeholder="glm-5.2"
                  className="eo-input w-full"
                />
                <p className="text-xs text-muted mt-1">官方确认支持 function calling</p>
              </div>
              <div>
                <label className="eo-label block mb-1.5">联网搜索模型</label>
                <input
                  type="text"
                  value={form.glm?.webSearchModel || ''}
                  onChange={(e) => updateGlm('webSearchModel', e.target.value)}
                  placeholder="glm-4-air"
                  className="eo-input w-full"
                />
                <p className="text-xs text-muted mt-1">官方示例用此模型，5.2 未明确</p>
              </div>
              <div>
                <label className="eo-label block mb-1.5">搜索引擎</label>
                <select
                  value={form.glm?.webSearchEngine || 'search_std'}
                  onChange={(e) => updateGlm('webSearchEngine', e.target.value)}
                  className="eo-input w-full"
                >
                  <option value="search_std">search_std（基础，0.01元/次）</option>
                  <option value="search_pro">search_pro（高级，0.03元/次）</option>
                  <option value="search_pro_sogou">search_pro_sogou（搜狗，0.05元/次）</option>
                  <option value="search_pro_quark">search_pro_quark（夸克，0.05元/次）</option>
                </select>
                <p className="text-xs text-muted mt-1">联网搜索按次计费</p>
              </div>
            </div>
          </div>

          <div className="mt-3 text-xs text-info-fg bg-info-bg rounded p-2">
            两个能力各用一个模型（function calling 用 glm-5.2、web_search 用 glm-4-air），互不影响普通 GLM 调用。仅开放只读工具；写操作（建需求/改报价）需二次确认 UI，暂未开放。
          </div>
        </div>

        {/* Ollama 本地模型 */}
        <div className="eo-card p-5 border-l-4 border-l-green-500">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-success-bg flex items-center justify-center">
              <HardDrive size={20} className="text-success-fg" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Ollama 本地模型（离线降级）</h3>
              <p className="text-xs text-muted">断网或云端不可用时自动降级到本地模型，数据不出设备</p>
            </div>
            {form.ollama?.status === 'ok' ? (
              <span className="ml-auto flex items-center gap-1 text-xs text-success-fg bg-success-bg px-2 py-1 rounded">
                <Wifi size={12} /> 在线
              </span>
            ) : form.ollama?.status === 'offline' ? (
              <span className="ml-auto flex items-center gap-1 text-xs text-danger-fg bg-danger-bg px-2 py-1 rounded">
                <WifiOff size={12} /> 离线
              </span>
            ) : (
              <span className="ml-auto text-xs text-muted bg-canvas px-2 py-1 rounded">未配置</span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="eo-label block mb-1.5">Base URL</label>
              <input
                type="text"
                value={form.ollama?.baseUrl || ''}
                onChange={(e) => setForm((prev: any) => ({ ...prev, ollama: { ...prev.ollama, baseUrl: e.target.value } }))}
                placeholder="http://127.0.0.1:11434/v1"
                className="eo-input w-full"
              />
              <p className="text-xs text-muted mt-1">需先安装 Ollama：ollama.com</p>
            </div>
            <div>
              <label className="eo-label block mb-1.5">模型名称</label>
              <input
                type="text"
                value={form.ollama?.model || ''}
                onChange={(e) => setForm((prev: any) => ({ ...prev, ollama: { ...prev.ollama, model: e.target.value } }))}
                placeholder="qwen2.5:14b"
                className="eo-input w-full"
              />
              <p className="text-xs text-muted mt-1">推荐：qwen2.5:14b（中文效果好）</p>
            </div>
          </div>
          <div className="mt-3 text-xs text-success-fg bg-success-bg rounded p-2">
            本地模型特点：完全离线、数据不出设备、无需 API 费用。效果弱于云端大模型，但作为降级方案可保证核心功能可用。
          </div>
        </div>

        <div className="eo-card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-accent-50 flex items-center justify-center">
              <Database size={20} className="text-accent-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Embedding 向量模型</h3>
              <p className="text-xs text-muted">用于知识库文档的向量检索</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="eo-label block mb-1.5">Provider</label>
              <select
                value={form.embedding?.provider || 'basic'}
                onChange={(e) => updateEmbedding('provider', e.target.value)}
                className="eo-input w-full"
              >
                <option value="basic">basic（本地中文向量，无需 GPU）</option>
                <option value="local">local（BAAI/bge-small-zh-v1.5）</option>
                <option value="openai">openai（需 OpenAI Key）</option>
                <option value="mock">mock（占位测试）</option>
              </select>
            </div>
            <div>
              <label className="eo-label block mb-1.5">模型名称</label>
              <input
                type="text"
                value={form.embedding?.model || ''}
                onChange={(e) => updateEmbedding('model', e.target.value)}
                className="eo-input w-full"
              />
            </div>
          </div>
        </div>

        <div className="eo-card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-warning-bg flex items-center justify-center">
              <Zap size={20} className="text-warning-fg" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">RAG 检索参数</h3>
              <p className="text-xs text-muted">控制知识库检索的切片大小和召回数量</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="eo-label block mb-1.5">Top-K（召回数）</label>
              <input
                type="number"
                value={form.rag?.topK ?? 5}
                onChange={(e) => updateRag('topK', parseInt(e.target.value) || 5)}
                className="eo-input w-full"
                min={1}
                max={50}
              />
            </div>
            <div>
              <label className="eo-label block mb-1.5">Chunk Size（切片长度）</label>
              <input
                type="number"
                value={form.rag?.chunkSize ?? 500}
                onChange={(e) => updateRag('chunkSize', parseInt(e.target.value) || 500)}
                className="eo-input w-full"
                min={100}
                max={2000}
              />
            </div>
            <div>
              <label className="eo-label block mb-1.5">Chunk Overlap（重叠）</label>
              <input
                type="number"
                value={form.rag?.chunkOverlap ?? 100}
                onChange={(e) => updateRag('chunkOverlap', parseInt(e.target.value) || 100)}
                className="eo-input w-full"
                min={0}
                max={500}
              />
            </div>
          </div>
        </div>

        <div className="bg-info-bg border border-info-line rounded-lg p-4 text-sm text-info-fg">
          <div className="flex items-center gap-2 mb-1">
            <Server size={16} />
            <span className="font-medium">说明</span>
          </div>
          <p>配置保存后会立即写入 AI 服务 .env 文件并热重载。模块路由：DeepSeek → 报价/文档/产品/需求分析；GLM → 方案/客户。两个 Key 都需填写才能覆盖全部 AI 功能。云端不可用时自动降级到 Ollama 本地模型。</p>
        </div>
      </div>
    </div>
  )
}

