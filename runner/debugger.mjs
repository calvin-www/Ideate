// Keep tracing outside the student's globals. The pause callback sends only
// bounded text snapshots and suspends the live Python stack using JSPI.
export const DEBUG_RUNNER = `
def _ideate_make_debug_runner():
    import sys
    import json
    import ast
    from pyodide.ffi import run_sync
    dumps = json.dumps
    async_compile = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT
    monitoring = sys.monitoring
    tool_id = monitoring.DEBUGGER_ID

    def display(value, depth=0):
        kind = type(value)
        if kind is str:
            return repr(value[:160]) + ('...' if len(value) > 160 else '')
        if kind is int or kind is float or kind is bool or kind is type(None):
            try:
                return repr(value)[:240]
            except Exception:
                return '<large number>'
        if depth < 2 and (kind is list or kind is tuple or kind is dict or kind is set or kind is frozenset):
            if kind is dict:
                parts = []
                for index, (key, item) in enumerate(value.items()):
                    if index == 6: break
                    parts.append(display(key, depth+1) + ': ' + display(item, depth+1))
                left, right = '{', '}'
            else:
                parts = []
                for index, item in enumerate(value):
                    if index == 6: break
                    parts.append(display(item, depth+1))
                left, right = ('[', ']') if kind is list else ('(', ')') if kind is tuple else ('{', '}')
            if len(value) > 6: parts.append('...')
            return (left + ', '.join(parts) + right)[:240]
        # Never invoke a student's __repr__: inspection must not execute code.
        return '<object>'

    def execute(source, namespace, pause):
        program = compile(source, 'main.py', 'exec', flags=async_compile)
        stepping = True
        def trace(code, line):
            nonlocal stepping
            if code.co_filename != 'main.py':
                return None
            if stepping:
                frame = sys._getframe(1)
                values = []
                for name, value in frame.f_locals.copy().items():
                    if type(name) is not str or name.startswith('__'): continue
                    try:
                        text = display(value)[:240]
                    except Exception:
                        text = '<value unavailable>'
                    values.append({'name': name[:80], 'value': text})
                    if len(values) == 25: break
                snapshot = dumps({'line': line, 'functionName': code.co_name[:128], 'locals': values})
                stepping = run_sync(pause(snapshot)) != 'continue'
                if not stepping: monitoring.set_events(tool_id, 0)
        # Monitoring follows execution across Pyodide's suspended stacks;
        # sys.settrace is thread-state local and loses tracing after await.
        monitoring.use_tool_id(tool_id, 'ideate')
        try:
            monitoring.register_callback(tool_id, monitoring.events.LINE, trace)
            monitoring.set_events(tool_id, monitoring.events.LINE)
            result = eval(program, namespace)
            if result is not None:
                run_sync(result)
        finally:
            monitoring.free_tool_id(tool_id)
    return execute
_ideate_make_debug_runner()
`;
