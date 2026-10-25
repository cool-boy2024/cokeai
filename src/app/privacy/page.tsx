import type { Metadata } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "隐私政策",
  description: "CokeAI 平台隐私与数据处理说明。",
};

const supportEmail = process.env.SUPPORT_EMAIL || "support@cokeai.cc.cd";

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="legal">
        <div className="container-narrow">
          <h1>隐私政策</h1>
          <div className="legal-meta">最后更新：2026-10-25</div>

          <p>
            本政策说明 CokeAI 在提供 AI API 接入服务时如何处理个人信息。
            我们的设计原则是：只收集运营与计费必需的数据，默认不保留模型请求正文。
          </p>

          <h2>1. 我们收集的信息</h2>
          <ul>
            <li>账户信息：昵称、邮箱、密码哈希、注册时间与推荐关系。</li>
            <li>计费信息：套餐、订单、支付渠道返回的交易编号、余额与佣金记录。</li>
            <li>API 元数据：模型 ID、输入/输出 Token 数、费用、延迟、状态、Request ID。</li>
            <li>安全日志：IP 地址、User-Agent、登录时间与速率限制记录。</li>
            <li>客服记录：你主动提交的问题、邮件与授权范围内的诊断信息。</li>
          </ul>
          <p>
            我们不会默认收集或持久化保存你的提示词、上传文件与模型输出正文。
          </p>

          <h2>2. 信息的使用</h2>
          <ul>
            <li>创建与维护账户、完成套餐交付和余额结算。</li>
            <li>执行硬预算、限流、并发控制与防欺诈。</li>
            <li>排查故障、提供支持、生成脱敏的用量与财务报告。</li>
            <li>履行法律义务、响应主管机关合法要求。</li>
          </ul>

          <h2>3. 第三方服务</h2>
          <p>
            为完成支付、模型调用与基础设施运行，我们可能向以下类别服务商传递必要信息：
          </p>
          <ul>
            <li>支付服务商（如 Stripe）：邮箱、订单金额与订单标识。</li>
            <li>模型上游供应商：你发出的请求内容与鉴权信息，用于生成响应。</li>
            <li>云主机、数据库与日志基础设施：必要的账户与计量数据。</li>
          </ul>
          <p>
            上游供应商可能按其自身隐私政策处理请求内容。请勿提交你无权披露的敏感数据。
          </p>

          <h2>4. 数据保留</h2>
          <ul>
            <li>账户与订单数据在账户存续期间及法律要求的期限内保留。</li>
            <li>用量元数据默认保留 12 个月，用于账单核对与风控。</li>
            <li>登录与限流日志保留较短周期，通常不超过 90 天。</li>
            <li>会话在到期、退出登录或撤销后失效。</li>
          </ul>

          <h2>5. 安全措施</h2>
          <p>
            密码使用 bcrypt 哈希存储；平台 API Key 仅保存 SHA-256 哈希；上游 API Key 使用
            AES-256-GCM 加密存储；管理操作要求独立管理员权限。尽管采取合理保护措施，
            互联网服务仍无法保证绝对安全。
          </p>

          <h2>6. Cookies</h2>
          <p>
            平台仅使用必要的会话 Cookie 维持登录状态。当前未接入广告或跨站行为追踪 Cookie。
            禁用必要 Cookie 将导致无法登录控制台。
          </p>

          <h2>7. 你的权利</h2>
          <p>
            在适用法律范围内，你可以请求访问、更正、导出或删除个人信息，撤回非必要处理授权，
            或申请注销账户。涉及财务与风控的数据可能依法保留特定期限。请发送邮件至{" "}
            <a className="text-link" href={`mailto:${supportEmail}`}>{supportEmail}</a>。
          </p>

          <h2>8. 未成年人</h2>
          <p>
            本平台面向具备相应民事行为能力的开发者和企业用户，不面向未成年人提供服务。
            如发现未成年人未经监护人同意注册，我们将停用相关账户。
          </p>

          <h2>9. 政策更新</h2>
          <p>
            我们可能因法律、产品或基础设施变化更新本政策，并在本页面标注最后更新时间。
            重大变更会通过站内通知或邮件告知。
          </p>

          <h2>10. 联系我们</h2>
          <p>
            隐私相关问题请联系：{" "}
            <a className="text-link" href={`mailto:${supportEmail}`}>{supportEmail}</a>。
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
