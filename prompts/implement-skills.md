I would like to implement skills support into hns, on boot I want a message just like we have for Loaded prompt
templates to display a list of the loaded skills, just their names. please use the "peach"\
color from the theme to color "Loaded prompt templates (5):" and the new "Loaded skills (N):"

Read these docs: @docs/skills-spec.md @docs/adding-skills-support.md

Just like all other loaded assets load them from .hns folders. ./.hns/skills/ > ~/.hns/skills/ > built in src/skills/*

Look at how @../pi-mono/ pi does it.

I added a section on the @src/shared/session/SYSTEM_PROMPT_TEMPLATE.md for skills. {{SKILLS}} should be replaced by a
list: `- {{skill name}} - {{skill description}}`
