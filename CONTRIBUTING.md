# 协作规则

这个仓库由两位维护者共同开发。`main` 只接受 Pull Request，任何人都不要直接往 `main` 推代码。

## 角色

- **仓库所有者**：管理仓库设置、生产部署和 GitHub Secrets。
- **共同维护者**：可以拉分支、开 PR、审核、合并，不接触生产服务器凭据。

朋友接受邀请后：

1. 把他的 GitHub 用户名加到 `.github/CODEOWNERS`。
2. 在仓库 **Settings → Collaborators** 里给他 **Maintain** 权限；不要给 Admin。
3. 两人都按下面的流程提交，谁的 PR 由另一个人审核和合并。

## 一次改动的完整流程

```bash
# 1. 从最新 main 开分支
git switch main
git pull --ff-only
git switch -c feat/announcement-bar

# 2. 小步提交，提交信息说清做了什么
git add <本次改动的文件>
git commit -m "feat(ui): add announcement bar"

# 3. 推到自己的分支
git push -u origin feat/announcement-bar

# 4. 开 PR，目标分支选 main
gh pr create --base main --fill
```

然后在 GitHub 上：

1. 另一位维护者看 diff、看验证步骤，必要时要求补充。
2. CI 必须通过：`build`、`e2e`、`compose-smoke`。
3. 审核人用 **Squash and merge** 合并，删除分支。
4. 合并后双方本地执行 `git switch main && git pull --ff-only`。

### 谁合并

- 你开的 PR，由朋友审核并合并。
- 朋友开的 PR，由你审核并合并。
- 不合并自己的 PR；紧急情况下也必须先让另一个人看过。

## 分支命名

| 前缀 | 用途 | 例子 |
| --- | --- | --- |
| `feat/` | 新功能 | `feat/announcement-bar` |
| `fix/` | 修 bug | `fix/shop-price-rounding` |
| `chore/` | 依赖、CI、配置 | `chore/update-cloudflared` |
| `docs/` | 只改文档 | `docs/pricing-policy` |
| `hotfix/` | 线上紧急修复 | `hotfix/usdt-callback` |

## 提交信息

用一句话说明改动，不要写“update”或“fix bug”。

```text
feat(shop): show announcement before checkout
fix(pricing): keep retail price above procurement cost
docs(collab): document the pull request flow
```

## 不能进仓库的东西

- `.env`、`.env.local` 和任何真实密钥
- 服务器密码、SSH 私钥、Cloudflare Tunnel token
- USDT 助记词、私钥、xprv
- 供应商账号密码、易支付 PID/KEY
- 生产数据库导出和用户数据

模板文件 `.env.example` 只能放占位符。需要新增环境变量时，同步更新 `.env.example` 和服务器 `.env`，真实值只在服务器上填写。

供应商 key、支付密钥这类凭据由所有者直接在服务器 `.env` 或 GitHub Secrets 里配置，不通过 PR、issue、聊天发送。

## 价格改动

价格必须能解释清楚：

- **官方价**：模型或订阅的官方标价。
- **拿货价**：我们实际支付给上游的成本。
- **卖价**：公开页面显示、实际扣费的价格。

改价格逻辑时，在 PR 里写清公式、示例和最低毛利；不要只改一个数字。价格、支付、订单相关的改动必须由另一位维护者重点审核。

## 部署

- 合并到 `main` 不等于自动上线。
- 两位维护者都可以在 `main` 合并后用 `npm run deploy:prod` 触发部署；生产密钥仍只在仓库 Secrets，只允许 `main`，不在 VPS 上构建。
- 上线前备份数据库和当前镜像，上线后做健康检查和关键页面验证。
- 数据库迁移必须单独说明回滚方式。

## 分支保护

当前仓库是 GitHub Free 的私有仓库，GitHub 不允许开启分支保护或 ruleset。也就是说，上面“只能通过 PR 修改 main”目前靠两个人自觉执行，GitHub 不会强制拦截。

建议升级到 GitHub Pro 后，在 **Settings → Rules → New branch ruleset** 开启：

- Target branch: `main`
- Require a pull request before merging
- Required approvals: `1`
- Dismiss stale approvals
- Require review from Code Owners
- Require status checks: `build`、`e2e`、`compose-smoke`
- Require conversation resolution
- Block force pushes
- Do not allow bypassing the ruleset

升级前，至少保持这两条硬规则：

1. 本地永远不在 `main` 上提交。
2. 每次合并前，另一个人必须在 PR 里留下审核意见。

## 邀请朋友

所有者执行（把 `FRIEND_USERNAME` 换成朋友的 GitHub 用户名）：

```bash
gh api -X PUT repos/cool-boy2024/cokeai/collaborators/FRIEND_USERNAME \
  -f permission=maintain
```

朋友接受邀请后，把 `.github/CODEOWNERS` 里的用户名补上，再开一个 `chore/codeowners` PR 合并。
