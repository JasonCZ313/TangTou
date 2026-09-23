# 躺投 (TangTou)

> 项目简介待补充。后续推送到 GitHub 时，请保持本仓库目录与提交规范不变。

## 仓库信息

| 项 | 说明 |
| --- | --- |
| 主远程 | `http://git.jflare.com/CaoZ/TangTou.git` |
| 默认分支 | `main` |
| 编码 | UTF-8 |
| 换行 | LF（由 `.gitattributes` / `.editorconfig` 统一） |

## 目录结构

```text
TangTou/
├── .editorconfig      # 编辑器统一格式
├── .gitattributes     # Git 换行与二进制处理
├── .gitignore         # 忽略构建产物、密钥、依赖等
├── README.md          # 项目说明（本文件）
├── docs/              # 设计说明、接口文档、运维文档
└── src/               # 业务源代码（按技术栈再细分）
```

## 本地开发

```powershell
# 克隆（已有本地目录时可跳过）
git clone http://git.jflare.com/CaoZ/TangTou.git

# 查看远程
git remote -v

# 拉取 / 推送（默认分支 main）
git pull origin main
git push -u origin main
```

后续若增加 GitHub 远程，建议命名为 `github`，保留 `origin` 指向当前私有 Git：

```powershell
git remote add github https://github.com/<你的用户名>/TangTou.git
git push -u github main
```

## 提交建议

- 使用清晰的提交说明（中文或英文均可，团队内统一一种）
- 不要提交 `.env`、密钥、依赖目录、构建产物
- 大文件、设计源文件默认已在 `.gitignore` 中忽略；确需入库时再显式取消忽略

## 许可证

待定。
