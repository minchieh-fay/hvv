# README

## About

This is the official Wails Vanilla template.

You can configure the project by editing `wails.json`. More information about the project settings can be found
here: https://wails.io/docs/reference/project-config

## Live Development

To run in live development mode, run `wails dev` in the project directory. This will run a Vite development
server that will provide very fast hot reload of your frontend changes. If you want to develop in a browser
and have access to your Go methods, there is also a dev server that runs on http://localhost:34115. Connect
to this in your browser, and you can call your Go code from devtools.

## Building

To build a redistributable, production mode package, use `wails build`.

## GitHub Actions 发布

`.github/workflows/build.yml` 会自动构建以下版本：

- macOS Intel (`darwin/amd64`)
- macOS Apple Silicon (`darwin/arm64`)
- Windows x86-64 (`windows/amd64`)

发布正式版本时，给提交创建并推送一个 `v` 开头的 tag：

```bash
git tag v0.1.0
git push origin v0.1.0
```

推送 tag 后，工作流会构建三个 zip 文件，并自动创建对应的 GitHub
Release。每次发布完成后，只保留最新的 3 个正式 Release，更旧的 Release
及对应 tag 会自动删除。
