"""
Mini MCP server for testing pi-mcp-adapter prompt slash commands.
Run with: python3 __tests__/fixtures/prompt-test-server.py
"""
from fastmcp import FastMCP

mcp = FastMCP("PromptTestServer")


@mcp.prompt
def greeting(name: str = "World") -> str:
    """A friendly greeting prompt with an optional name argument."""
    return f"Hello, {name}! How can I help you today?"


@mcp.prompt
def code_review(language: str, focus: str = "correctness") -> str:
    """Review code in a specific language, focusing on a particular area.

    Args:
        language: The programming language (required)
        focus: What to focus the review on (default: correctness)
    """
    return f"Please review the following {language} code, focusing on {focus}."


@mcp.prompt
def simple() -> str:
    """A simple prompt with no arguments — auto-executes when invoked."""
    return "This is a simple no-argument prompt that auto-executes."


if __name__ == "__main__":
    mcp.run()
