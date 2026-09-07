import json
import uuid

from google import genai
from google.genai import types

__all__ = ["GeminiClient"]


def _to_declarations(tools):
    decls = []
    for t in tools or []:
        fn = t["function"] if t.get("type") == "function" else t
        decls.append(types.FunctionDeclaration(
            name=fn["name"],
            description=fn.get("description", ""),
            parameters_json_schema=fn.get("parameters") or {"type": "object", "properties": {}},
        ))
    return decls


def _to_contents(messages):
    system_bits, contents, call_names = [], [], {}
    for m in messages:
        role = m.get("role")
        if role == "system":
            system_bits.append(m.get("content") or "")
        elif role == "user":
            contents.append(types.Content(role="user", parts=[types.Part(text=m.get("content") or "")]))
        elif role == "assistant":
            parts = []
            if m.get("content"):
                parts.append(types.Part(text=m["content"]))
            for tc in m.get("tool_calls") or []:
                fn = tc["function"]
                call_names[tc["id"]] = fn["name"]
                parts.append(types.Part(function_call=types.FunctionCall(
                    name=fn["name"], args=json.loads(fn["arguments"] or "{}"))))
            if parts:
                contents.append(types.Content(role="model", parts=parts))
        elif role == "tool":
            name = call_names.get(m.get("tool_call_id"), m.get("name") or "tool")
            try:
                payload = json.loads(m.get("content") or "{}")
            except json.JSONDecodeError:
                payload = {"result": m.get("content")}
            if not isinstance(payload, dict):
                payload = {"result": payload}
            contents.append(types.Content(role="user", parts=[types.Part(
                function_response=types.FunctionResponse(name=name, response=payload))]))
        else:
            raise ValueError(f"gemini adapter: unsupported message role {role!r}")
    return ("\n\n".join(b for b in system_bits if b) or None), contents


def _tool_config(tool_choice):
    if tool_choice in (None, "auto"):
        mode = types.FunctionCallingConfigMode.AUTO
        allowed = None
    elif tool_choice == "none":
        mode, allowed = types.FunctionCallingConfigMode.NONE, None
    elif tool_choice == "required":
        mode, allowed = types.FunctionCallingConfigMode.ANY, None
    elif isinstance(tool_choice, dict):
        mode = types.FunctionCallingConfigMode.ANY
        allowed = [tool_choice["function"]["name"]]
    else:
        raise ValueError(f"gemini adapter: unsupported tool_choice {tool_choice!r}")
    return types.ToolConfig(function_calling_config=types.FunctionCallingConfig(
        mode=mode, allowed_function_names=allowed))


class _Message:

    def __init__(self, response):
        self.content = ""
        self.tool_calls = []
        self.reasoning_content = ""
        candidates = getattr(response, "candidates", None) or []
        parts = (candidates[0].content.parts if candidates and candidates[0].content else None) or []
        for p in parts:
            if getattr(p, "thought", None) and getattr(p, "text", None):
                self.reasoning_content += p.text
            elif getattr(p, "text", None):
                self.content += p.text
            fc = getattr(p, "function_call", None)
            if fc:
                self.tool_calls.append(_ToolCall(fc))


class _ToolCall:
    def __init__(self, fc):
        self.id = fc.id or f"call_{uuid.uuid4().hex[:12]}"
        self.type = "function"
        self.function = _Fn(fc.name, json.dumps(dict(fc.args or {})))

    def model_dump(self):
        return {"id": self.id, "type": "function",
                "function": {"name": self.function.name, "arguments": self.function.arguments}}


class _Fn:
    def __init__(self, name, arguments):
        self.name, self.arguments = name, arguments


class _Choice:
    def __init__(self, response):
        self.message = _Message(response)
        candidates = getattr(response, "candidates", None) or []
        self.finish_reason = str(getattr(candidates[0], "finish_reason", "") or "") if candidates else ""


class _Completion:
    def __init__(self, response):
        self.choices = [_Choice(response)]
        self.raw = response


class _Completions:
    def __init__(self, client):
        self._client = client

    def create(self, *, model, messages, tools=None, tool_choice=None, temperature=None,
               max_tokens=None, extra_body=None, **unsupported):
        if unsupported:
            raise TypeError(f"gemini adapter: unsupported argument(s) {sorted(unsupported)}")
        system, contents = _to_contents(messages)
        cfg = {"temperature": temperature, "max_output_tokens": max_tokens,
               "system_instruction": system}
        if tools:
            cfg["tools"] = [types.Tool(function_declarations=_to_declarations(tools))]
            cfg["tool_config"] = _tool_config(tool_choice)
            cfg["automatic_function_calling"] = types.AutomaticFunctionCallingConfig(disable=True)

        thinking = (extra_body or {}).get("thinking_budget")
        if thinking is not None:
            cfg["thinking_config"] = types.ThinkingConfig(thinking_budget=thinking)

        response = self._client.models.generate_content(
            model=model, contents=contents,
            config=types.GenerateContentConfig(**{k: v for k, v in cfg.items() if v is not None}))
        return _Completion(response)


class _Chat:
    def __init__(self, client):
        self.completions = _Completions(client)


class GeminiClient:

    def __init__(self, api_key: str):
        self._client = genai.Client(api_key=api_key)
        self.chat = _Chat(self._client)

    def list_models(self):
        return [m.name.replace("models/", "") for m in self._client.models.list()]
