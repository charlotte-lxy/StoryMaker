@tool
extends EditorPlugin

## StoryMaker 的编辑器侧桥。
##
## 只做一件事：在 127.0.0.1 上开一个 TCP 端口，把编辑器的状态（工程名、路径、引擎版本）
## 回给 StoryMaker。素材文件的字节不从这里走——StoryMaker 主进程直接写 res:// 目录，
## 插件不碰文件系统，权限面越窄越好。
##
## 端口是固定的，令牌（token）每次启动随机生成，写进工程目录的
## `.godot/storymaker_bridge.json`。StoryMaker 必须先知道工程路径才能读到它，
## 所以界面上要求先选 project.godot。

const PLUGIN_VERSION := "0.1.0"
const PORT := 27185
const PAIRING_PATH := "res://.godot/storymaker_bridge.json"

## 同时挂着的连接上限：本机几个请求而已，多了说明有别的东西在连
const MAX_PEERS := 8
## 一个请求连上来迟迟不发完整一行的，超过这个时间就踢掉（毫秒）
const REQUEST_TIMEOUT_MS := 5000

var _server: TCPServer = null
var _token := ""
## 每条：{ peer: StreamPeerTCP, buffer: String, started: int }
var _peers: Array = []


func _enter_tree() -> void:
	_token = _make_token()
	_start_server()
	_write_pairing_file()


func _exit_tree() -> void:
	_drop_peers()
	if _server != null and _server.is_listening():
		_server.stop()
	_server = null
	_remove_pairing_file()


func _process(_delta: float) -> void:
	if _server == null:
		return

	while _server.is_connection_available() and _peers.size() < MAX_PEERS:
		var peer := _server.take_connection()
		if peer == null:
			break
		_peers.append({
			"peer": peer,
			"buffer": "",
			"started": Time.get_ticks_msec(),
		})

	var now := Time.get_ticks_msec()
	var alive: Array = []
	for entry in _peers:
		var peer: StreamPeerTCP = entry["peer"]
		peer.poll()
		var status := peer.get_status()

		if status != StreamPeerTCP.STATUS_CONNECTED:
			entry["peer"] = null
			continue

		if now - int(entry["started"]) > REQUEST_TIMEOUT_MS:
			peer.disconnect_from_host()
			entry["peer"] = null
			continue

		# 已经回过话：等对端自己关（StoryMaker 读完就 destroy），这里只负责收尸。
		# 回完立刻 disconnect 可能会把还没发出去的那一行丢掉。
		if bool(entry.get("answered", false)):
			alive.append(entry)
			continue

		var available := peer.get_available_bytes()
		if available > 0:
			entry["buffer"] = String(entry["buffer"]) + peer.get_utf8_string(available)

		var buffer := String(entry["buffer"])
		if buffer.contains("\n"):
			var line := buffer.split("\n", true, 1)[0]
			# 回包也以换行结尾，StoryMaker 那边按行解析
			peer.put_data((_handle_line(line.strip_edges()) + "\n").to_utf8_buffer())
			entry["answered"] = true
			entry["buffer"] = ""
			alive.append(entry)
			continue

		alive.append(entry)

	_peers = alive


func _start_server() -> void:
	_server = TCPServer.new()
	# 只绑回环地址：别的机器连不进来
	var error := _server.listen(PORT, "127.0.0.1")
	if error != OK:
		_server = null
		push_error(
			"StoryMaker Bridge 起不来：端口 %d 被占用（可能开了另一个 Godot 编辑器？）。" % PORT
		)


func _handle_line(line: String) -> String:
	var parsed: Variant = JSON.parse_string(line)
	if typeof(parsed) != TYPE_DICTIONARY:
		return _error_reply(0, "请求不是合法的 JSON")

	var request: Dictionary = parsed
	var id := int(request.get("id", 0))

	if String(request.get("token", "")) != _token:
		return _error_reply(id, "令牌不对，请重新在 StoryMaker 里检测连接")

	var action := String(request.get("action", ""))
	match action:
		"ping":
			return _reply(id, _describe_editor())
		_:
			return _error_reply(id, "不认识的动作：%s" % action)


func _describe_editor() -> Dictionary:
	return {
		"pluginVersion": PLUGIN_VERSION,
		"projectName": String(ProjectSettings.get_setting("application/config/name", "")),
		"projectPath": ProjectSettings.globalize_path("res://"),
		"engineVersion": String(Engine.get_version_info().get("string", "")),
		"pid": OS.get_process_id(),
	}


func _reply(id: int, result: Dictionary) -> String:
	return JSON.stringify({"id": id, "ok": true, "result": result})


func _error_reply(id: int, message: String) -> String:
	return JSON.stringify({"id": id, "ok": false, "error": message})


func _write_pairing_file() -> void:
	if _server == null:
		return
	var payload := {
		"port": PORT,
		"token": _token,
		"pluginVersion": PLUGIN_VERSION,
		"projectPath": ProjectSettings.globalize_path("res://"),
		"pid": OS.get_process_id(),
	}
	var file := FileAccess.open(PAIRING_PATH, FileAccess.WRITE)
	if file == null:
		push_error("StoryMaker Bridge 写不了 %s（错误码 %d）" % [PAIRING_PATH, FileAccess.get_open_error()])
		return
	file.store_string(JSON.stringify(payload))
	file.close()


func _remove_pairing_file() -> void:
	if FileAccess.file_exists(PAIRING_PATH):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(PAIRING_PATH))


func _drop_peers() -> void:
	for entry in _peers:
		var peer: StreamPeerTCP = entry["peer"]
		if peer != null:
			peer.disconnect_from_host()
	_peers.clear()


func _make_token() -> String:
	var bytes := Crypto.new().generate_random_bytes(24)
	return bytes.hex_encode()
