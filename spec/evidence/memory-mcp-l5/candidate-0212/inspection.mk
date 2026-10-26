# Evidence inspection only. This target is not a catalog proof or acceptance gate.
.PHONY: memory-l5-inspect-candidate
memory-l5-inspect-candidate:
	bash spec/evidence/memory-mcp-l5/candidate-0212/collect.sh
