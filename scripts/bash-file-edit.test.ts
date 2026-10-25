import assert from "node:assert/strict";
import test from "node:test";

import { detectBashFileEdit } from "../extensions/bash-file-edit.ts";

test("sed -i in its GNU and BSD forms is an edit of the named files", () => {
	assert.deepEqual(detectBashFileEdit("sed -i 's/a/b/' stats.py"), { kind: "edit", via: "sed", paths: ["stats.py"] });
	assert.deepEqual(detectBashFileEdit("sed -i '' 's/a/b/' stats.py"), { kind: "edit", via: "sed", paths: ["stats.py"] });
	assert.deepEqual(detectBashFileEdit("sed -i.bak -e 's/a/b/' -e 's/c/d/' a.txt b.txt"), { kind: "edit", via: "sed", paths: ["a.txt", "b.txt"] });
	assert.deepEqual(detectBashFileEdit("sed -E -i 's/(x)/y/g' src/x.ts"), { kind: "edit", via: "sed", paths: ["src/x.ts"] });
	assert.deepEqual(
		detectBashFileEdit("cd pkg && sed -i 's/a/b/' x.ts && sed -i 's/c/d/' y.ts"),
		{ kind: "edit", via: "sed", paths: ["x.ts", "y.ts"], cd: "pkg" },
	);
});

test("perl -pi is an edit", () => {
	assert.deepEqual(detectBashFileEdit("perl -pi -e 's/a/b/' f.rb"), { kind: "edit", via: "perl", paths: ["f.rb"] });
	assert.deepEqual(detectBashFileEdit("perl -i -pe 's/a/b/' f.rb g.rb"), { kind: "edit", via: "perl", paths: ["f.rb", "g.rb"] });
});

test("heredocs and echo/printf redirects write a file, appends edit it", () => {
	assert.deepEqual(
		detectBashFileEdit("cat > notes.md <<'EOF'\n# Notes\n\n$HOME stays literal\nEOF"),
		{ kind: "write", via: "heredoc", paths: ["notes.md"], content: "# Notes\n\n$HOME stays literal\n" },
	);
	assert.deepEqual(
		detectBashFileEdit("mkdir -p docs && cat <<EOF > docs/a.md\nhello\nEOF"),
		{ kind: "write", via: "heredoc", paths: ["docs/a.md"], content: "hello\n" },
	);
	assert.deepEqual(
		detectBashFileEdit("cat >> log.txt <<EOF\nmore\nEOF"),
		{ kind: "edit", via: "append", paths: ["log.txt"], content: "more\n" },
	);
	assert.deepEqual(
		detectBashFileEdit("tee out.txt <<'EOF'\nx\nEOF"),
		{ kind: "write", via: "heredoc", paths: ["out.txt"], content: "x\n" },
	);
	assert.deepEqual(detectBashFileEdit('echo "hi there" > a.txt'), { kind: "write", via: "echo", paths: ["a.txt"], content: "hi there\n" });
	assert.deepEqual(detectBashFileEdit("printf 'x\\n' >> a.txt"), { kind: "edit", via: "append", paths: ["a.txt"], content: undefined });
	// An unquoted delimiter expands $VAR in the body, so the written text is unknown here.
	assert.deepEqual(
		detectBashFileEdit("cat > a.sh <<EOF\necho $HOME\nEOF"),
		{ kind: "write", via: "heredoc", paths: ["a.sh"], content: undefined },
	);
});

test("anything else stays a bash command", () => {
	for (const command of [
		"sed 's/a/b/' stats.py",
		"sed -n '1,5p' stats.py",
		"sed -i 's/a/b/' *.py",
		"sed -i 's/a/b/' $FILE",
		"sed -i 's/a/b/' stats.py && npm test",
		"grep -l foo . | xargs sed -i 's/a/b/'",
		"cat stats.py",
		"cat > a.txt <<'EOF'\nunterminated",
		"cat > a.txt <<'EOF'\nx\nEOF\nnpm test",
		"echo hi",
		"echo hi > /dev/null",
		"python3 - <<'EOF'\nopen('a','w').write('x')\nEOF",
		"echo \"$(date)\" > stamp.txt",
		"",
	]) {
		assert.equal(detectBashFileEdit(command), undefined, command);
	}
});
