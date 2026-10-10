# 合成大豆包

版本：v2.3.2。支持电脑和手机浏览器的 11 级合成小游戏。

## 游玩

在本仓库 Settings → Pages 中查看游戏网址。拖动瞄准，松手投放；电脑支持鼠标和键盘操作。

同级物体相碰会合成下一级。第 8–11 级依次为 DS、GPT、Claude、豆包。前 4 颗为两个智谱、两个 MiniMax，顺序随机；随后每组 10 颗包含 4 智谱、3 MiniMax、2 Meta、1 Qwen，同级最多连续两颗。保留 10 项成就，记录保存在当前浏览器。

## GitHub Pages 设置

无需构建或安装依赖。在 Settings → Pages → Build and deployment 中选择 Deploy from a branch，分支 main，目录 /(root)，保存。发布成功后 Pages 页面会提供游戏网址。

index.html 必须直接位于仓库根目录，assets 目录与它同级。

## 更新

将新版静态部署包解压后的内容覆盖到仓库根目录，提交后等待 Pages 完成部署。请使用固定的游戏网址保留同浏览器的本地记录。
