import type { ResourceKind } from "../studyPlan/types";

// The built-in "Programming: zero to hero" curriculum: a complete path from
// how a computer runs code to design, systems and professional practice,
// with C++ as the language the exercises are written in. Pure data — see
// install.ts for how it becomes a course and study plan.
//
// Shaped from what the standard self-taught-CS lists (Teach Yourself CS),
// staged modern-C++ paths, and senior-engineer skill lists agree on:
// fundamentals → memory and ownership → algorithms → writing good code →
// design and architecture → how machines and networks work → data and
// distributed systems → professional practice → capstones.
//
// Order is a teaching order: `prerequisites` name EARLIER chapters by title
// (chapters.ts checks each exists and comes first), and a chapter's stage is
// derived from them. Minutes are a realistic total for reading, exercises and the
// chapter's project — not just a skim.

export interface CurriculumResource {
  kind: ResourceKind;
  title: string;
  url: string;
  provider: string;
}

export interface CurriculumChapter {
  title: string;
  // Which of the nine parts it belongs to; shown ahead of the summary.
  part: string;
  summary: string;
  subtopics: string[];
  // Titles of EARLIER chapters this one builds on.
  prerequisites: string[];
  estimatedMinutes: number;
  resources: CurriculumResource[];
}

export interface Curriculum {
  id: string;
  courseName: string;
  planTitle: string;
  language: "cpp";
  chapters: CurriculumChapter[];
}

const LEARNCPP: CurriculumResource = {
  kind: "book",
  title: "learncpp.com — the full modern C++ tutorial",
  url: "https://www.learncpp.com/",
  provider: "learncpp.com",
};
const CPPREFERENCE: CurriculumResource = {
  kind: "article",
  title: "cppreference — the C++ language and library reference",
  url: "https://en.cppreference.com/",
  provider: "cppreference.com",
};
const CORE_GUIDELINES: CurriculumResource = {
  kind: "article",
  title: "C++ Core Guidelines",
  url: "https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines",
  provider: "isocpp.org",
};
const GODBOLT: CurriculumResource = {
  kind: "interactive",
  title: "Compiler Explorer — see the assembly your code becomes",
  url: "https://godbolt.org/",
  provider: "godbolt.org",
};

const PART_FOUNDATIONS = "Part 1 · How computers and code work";
const PART_CORE = "Part 2 · Core C++ and memory";
const PART_ALGORITHMS = "Part 3 · Thinking in algorithms";
const PART_CRAFT = "Part 4 · Writing good code";
const PART_DESIGN = "Part 5 · Design and architecture";
const PART_MACHINE = "Part 6 · How the machine works";
const PART_DATA = "Part 7 · Data and systems";
const PART_PRACTICE = "Part 8 · Professional practice";

export const PROGRAMMING_CURRICULUM: Curriculum = {
  id: "programming",
  courseName: "Programming: zero to hero",
  planTitle: "Programming: zero to hero (C++)",
  language: "cpp",
  chapters: [
    // ---- Part 1 ------------------------------------------------------
    {
      title: "How a computer runs code",
      part: PART_FOUNDATIONS,
      summary: "A working mental model of the machine, so nothing later feels like magic.",
      subtopics: [
        "Bits, bytes, and how numbers, text and booleans are stored",
        "CPU, memory and storage: what each one does",
        "Instructions: what a program is to the processor",
        "Source code → compiler → linker → executable",
        "Compiled vs interpreted languages, and why C++ is compiled",
        "Reading a first program line by line",
      ],
      prerequisites: [],
      estimatedMinutes: 300,
      resources: [
        { kind: "course", title: "CS50: Introduction to Computer Science", url: "https://cs50.harvard.edu/x/", provider: "Harvard" },
        GODBOLT,
      ],
    },
    {
      title: "Your toolchain: terminal, compiler, errors",
      part: PART_FOUNDATIONS,
      summary: "Write, build and run programs from the command line, and read what the compiler tells you.",
      subtopics: [
        "The terminal: navigating, files, pipes",
        "Compiling and running with g++, and what the flags mean (-Wall, -Wextra, -std)",
        "Reading compiler errors and warnings top-down",
        "Editors and the edit → build → run loop",
        "Version control basics: init, commit, diff, log",
      ],
      prerequisites: ["How a computer runs code"],
      estimatedMinutes: 360,
      resources: [
        { kind: "course", title: "The Missing Semester of Your CS Education", url: "https://missing.csail.mit.edu/", provider: "MIT" },
        { kind: "book", title: "Pro Git", url: "https://git-scm.com/book/en/v2", provider: "git-scm.com" },
        LEARNCPP,
      ],
    },
    {
      title: "Reading documentation and navigating source code",
      part: PART_FOUNDATIONS,
      summary:
        "Learning how code works by walking through it: go to definition, follow a call, read the comments the authors left. The skill that lets you learn any codebase or library, including one with bad docs.",
      subtopics: [
        "Setting up code intelligence in your editor (clangd / VS Code): hover, go to definition, go to declaration, find all references",
        "Following a call: from a function call to its definition, its return type, and the types it uses",
        "Symbol search, the outline view, call hierarchy and type hierarchy",
        "Reading doc comments (Doxygen-style) and the contracts they state: preconditions, ownership, errors",
        "Reading a header file as an API: what's public, what's an implementation detail",
        "Searching a codebase: ripgrep, grep, and finding where a thing is defined or used",
        "Reading reference docs (cppreference) well: signatures, complexity, notes and examples",
        "Using git log, blame and history to learn why code is the way it is",
        "Stepping into code with a debugger as another way to follow what runs",
        "Practice: clone a small open-source C++ library and answer, from the code alone — where is this function defined, what does it return, who owns this memory, what does the comment promise?",
      ],
      prerequisites: ["Your toolchain: terminal, compiler, errors"],
      estimatedMinutes: 420,
      resources: [
        { kind: "article", title: "VS Code: code navigation", url: "https://code.visualstudio.com/docs/editor/editingevolved", provider: "Microsoft" },
        { kind: "article", title: "clangd: C++ code intelligence", url: "https://clangd.llvm.org/", provider: "LLVM" },
        { kind: "article", title: "ripgrep: fast code search", url: "https://github.com/BurntSushi/ripgrep", provider: "GitHub" },
        { kind: "article", title: "Doxygen manual: documenting code", url: "https://www.doxygen.nl/manual/docblocks.html", provider: "doxygen.nl" },
        CPPREFERENCE,
      ],
    },
    {
      title: "Variables, types, operators and I/O",
      part: PART_FOUNDATIONS,
      summary: "The vocabulary of every program: values, types, expressions, and talking to the user.",
      subtopics: [
        "Variables, initialisation and why uninitialised ones are dangerous",
        "Fundamental types, sizes, and integer overflow",
        "Arithmetic, comparison and logical operators; precedence",
        "Type conversion: implicit, explicit, and the traps",
        "std::cin / std::cout and formatted output",
        "Constants: const and constexpr",
      ],
      prerequisites: ["Your toolchain: terminal, compiler, errors"],
      estimatedMinutes: 420,
      resources: [LEARNCPP, CPPREFERENCE],
    },
    {
      title: "Control flow: decisions and loops",
      part: PART_FOUNDATIONS,
      summary: "Making a program choose and repeat: the logic that turns a calculator into a program.",
      subtopics: [
        "if / else, switch, and boolean logic",
        "while, do-while, for, range-for",
        "break, continue, and loop invariants",
        "Off-by-one errors and how to avoid them",
        "Nested loops and tracing a program by hand",
        "Breaking a problem into steps before coding (pseudocode)",
      ],
      prerequisites: ["Variables, types, operators and I/O"],
      estimatedMinutes: 480,
      resources: [LEARNCPP],
    },
    {
      title: "Functions, scope and the call stack",
      part: PART_FOUNDATIONS,
      summary: "Naming and reusing behaviour, and what actually happens in memory when a function is called.",
      subtopics: [
        "Parameters, return values, and pass-by-value",
        "Declarations vs definitions, and header files",
        "Scope and lifetime of local variables",
        "The call stack: frames, and what a stack overflow is",
        "Function overloading and default arguments",
        "Designing a function: one job, a clear name, no surprises",
      ],
      prerequisites: ["Control flow: decisions and loops"],
      estimatedMinutes: 480,
      resources: [LEARNCPP],
    },
    {
      title: "Arrays, strings and std::vector",
      part: PART_FOUNDATIONS,
      summary: "Working with collections of data, the most common thing programs do.",
      subtopics: [
        "Fixed arrays, indexing, and out-of-bounds access",
        "std::vector: growing, size vs capacity, iterating",
        "std::string and string_view: operations and pitfalls",
        "2D data: vectors of vectors and flat layouts",
        "Common patterns: accumulate, search, filter, transform by hand",
        "First project: a small text-processing tool",
      ],
      prerequisites: ["Functions, scope and the call stack"],
      estimatedMinutes: 540,
      resources: [LEARNCPP, CPPREFERENCE],
    },

    // ---- Part 2 ------------------------------------------------------
    {
      title: "References, pointers and the stack vs the heap",
      part: PART_CORE,
      summary: "How C++ talks about memory directly — the idea that makes C++ powerful and dangerous.",
      subtopics: [
        "Memory addresses and what a pointer is",
        "References vs pointers, and when to use which",
        "Stack allocation vs heap allocation (new / delete)",
        "Pointer arithmetic, arrays decaying to pointers",
        "Dangling pointers, leaks, double frees, null",
        "Pass by value, reference, const reference",
      ],
      prerequisites: ["Arrays, strings and std::vector"],
      estimatedMinutes: 600,
      resources: [LEARNCPP, CORE_GUIDELINES],
    },
    {
      title: "Ownership, RAII and smart pointers",
      part: PART_CORE,
      summary: "The idiom that makes modern C++ safe: tie a resource's lifetime to an object's.",
      subtopics: [
        "Who owns this memory? Ownership as a design question",
        "RAII: constructors acquire, destructors release",
        "std::unique_ptr: sole ownership",
        "std::shared_ptr and weak_ptr: shared ownership and cycles",
        "Why raw new/delete should almost never appear in modern code",
        "Finding leaks and invalid access with AddressSanitizer",
      ],
      prerequisites: ["References, pointers and the stack vs the heap"],
      estimatedMinutes: 540,
      resources: [
        LEARNCPP,
        CORE_GUIDELINES,
        { kind: "article", title: "AddressSanitizer", url: "https://github.com/google/sanitizers/wiki/AddressSanitizer", provider: "Google" },
      ],
    },
    {
      title: "Structs and classes: building your own types",
      part: PART_CORE,
      summary: "Bundling data with behaviour, and protecting the rules that keep it valid.",
      subtopics: [
        "struct vs class, members and member functions",
        "Constructors, initialiser lists, destructors",
        "Encapsulation: public interface, private state, invariants",
        "Operator overloading, used with restraint",
        "Static members, friends, and when not to use them",
        "Inheritance and virtual functions: dynamic dispatch",
      ],
      prerequisites: ["Ownership, RAII and smart pointers"],
      estimatedMinutes: 600,
      resources: [LEARNCPP, CORE_GUIDELINES],
    },
    {
      title: "Const, errors and exceptions",
      part: PART_CORE,
      summary: "Making wrong code hard to write, and handling the failures that are not bugs.",
      subtopics: [
        "const correctness for variables, parameters and member functions",
        "Bugs vs errors: assertions vs exceptions vs error codes",
        "Exceptions: throw, catch, and exception safety guarantees",
        "std::optional, std::variant, std::expected-style results",
        "Validating input at the boundary",
        "Designing error contracts for your functions",
      ],
      prerequisites: ["Structs and classes: building your own types"],
      estimatedMinutes: 420,
      resources: [LEARNCPP, CORE_GUIDELINES],
    },
    {
      title: "Move semantics and the rule of 0/3/5",
      part: PART_CORE,
      summary: "How C++ avoids expensive copies, and how to write types that copy and move correctly.",
      subtopics: [
        "Copying vs moving, and why copies cost",
        "lvalues, rvalues and rvalue references",
        "Copy and move constructors / assignment",
        "The rule of zero, three and five",
        "std::move, std::forward and what they really do",
        "Return value optimisation",
      ],
      prerequisites: ["Ownership, RAII and smart pointers", "Structs and classes: building your own types"],
      estimatedMinutes: 480,
      resources: [LEARNCPP, CPPREFERENCE],
    },
    {
      title: "The STL: containers, iterators, algorithms, lambdas",
      part: PART_CORE,
      summary: "The standard library's building blocks, and the habit of reaching for them before writing a loop.",
      subtopics: [
        "Sequence containers: vector, deque, list, array",
        "Associative containers: map, set, unordered_map, unordered_set",
        "Iterators and ranges",
        "<algorithm>: sort, find, transform, accumulate, remove_if",
        "Lambdas and captures",
        "Choosing the right container, and why it matters for speed",
      ],
      prerequisites: ["Const, errors and exceptions"],
      estimatedMinutes: 600,
      resources: [CPPREFERENCE, LEARNCPP],
    },

    // ---- Part 3 ------------------------------------------------------
    {
      title: "Complexity and Big-O",
      part: PART_ALGORITHMS,
      summary: "Reasoning about how code scales, before and instead of guessing.",
      subtopics: [
        "Counting operations: best, worst and average case",
        "Big-O, Big-Theta, and what they hide (constants, caches)",
        "Common classes: O(1), O(log n), O(n), O(n log n), O(n²), O(2ⁿ)",
        "Amortised analysis: why vector push_back is O(1)",
        "Space complexity",
        "Measuring: timing real code to check your reasoning",
      ],
      prerequisites: ["Arrays, strings and std::vector"],
      estimatedMinutes: 420,
      resources: [
        { kind: "book", title: "Algorithms — Jeff Erickson (free)", url: "https://jeffe.cs.illinois.edu/teaching/algorithms/", provider: "UIUC" },
        { kind: "article", title: "Big-O Cheat Sheet", url: "https://www.bigocheatsheet.com/", provider: "bigocheatsheet.com" },
      ],
    },
    {
      title: "Recursion, divide and conquer, backtracking",
      part: PART_ALGORITHMS,
      summary: "Solving a problem by solving smaller copies of it — a skill that has to be practised, not just read.",
      subtopics: [
        "Base case, recursive case, and the call stack",
        "Recursion vs iteration, and tail calls",
        "Divide and conquer: split, solve, combine",
        "Backtracking: permutations, subsets, N-Queens, mazes",
        "Memoising a recursion",
        "Recognising recursive structure in a problem",
      ],
      prerequisites: ["Functions, scope and the call stack", "Complexity and Big-O"],
      estimatedMinutes: 540,
      resources: [
        { kind: "book", title: "Algorithms — Jeff Erickson (free)", url: "https://jeffe.cs.illinois.edu/teaching/algorithms/", provider: "UIUC" },
        { kind: "interactive", title: "VisuAlgo — visualising algorithms", url: "https://visualgo.net/en", provider: "VisuAlgo" },
      ],
    },
    {
      title: "Sorting and searching",
      part: PART_ALGORITHMS,
      summary: "The classic algorithms, written by hand so you understand what the library does for you.",
      subtopics: [
        "Linear and binary search, and binary search on an answer",
        "Selection, insertion and bubble sort",
        "Merge sort and quicksort",
        "Stability, in-place sorting, and the n log n lower bound",
        "Using std::sort and custom comparators correctly",
        "Two pointers and sliding window",
      ],
      prerequisites: ["The STL: containers, iterators, algorithms, lambdas", "Recursion, divide and conquer, backtracking"],
      estimatedMinutes: 540,
      resources: [
        { kind: "interactive", title: "VisuAlgo — sorting", url: "https://visualgo.net/en/sorting", provider: "VisuAlgo" },
        { kind: "article", title: "CP-Algorithms", url: "https://cp-algorithms.com/", provider: "cp-algorithms.com" },
      ],
    },
    {
      title: "Core data structures, built by hand",
      part: PART_ALGORITHMS,
      summary: "Implement the structures you normally just use, so you know what they cost and why.",
      subtopics: [
        "Dynamic array (your own vector)",
        "Singly and doubly linked lists",
        "Stack and queue, and a ring buffer",
        "Hash map: hashing, collisions, resizing",
        "Binary heap and priority queue",
        "When to use which: reading costs off the structure",
      ],
      prerequisites: ["Move semantics and the rule of 0/3/5", "Sorting and searching"],
      estimatedMinutes: 720,
      resources: [
        { kind: "interactive", title: "VisuAlgo — data structures", url: "https://visualgo.net/en", provider: "VisuAlgo" },
        { kind: "book", title: "Algorithms — Jeff Erickson (free)", url: "https://jeffe.cs.illinois.edu/teaching/algorithms/", provider: "UIUC" },
      ],
    },
    {
      title: "Trees and graphs",
      part: PART_ALGORITHMS,
      summary: "The shapes that model hierarchies, networks and dependencies — most hard problems are secretly graphs.",
      subtopics: [
        "Binary trees and traversals (pre, in, post, level order)",
        "Binary search trees and balance",
        "Graph representations: adjacency list vs matrix",
        "BFS and DFS, and what each is for",
        "Shortest paths: BFS, Dijkstra",
        "Topological sort, union-find, and minimum spanning trees",
      ],
      prerequisites: ["Core data structures, built by hand"],
      estimatedMinutes: 720,
      resources: [
        { kind: "interactive", title: "VisuAlgo — graphs", url: "https://visualgo.net/en/graphds", provider: "VisuAlgo" },
        { kind: "article", title: "CP-Algorithms", url: "https://cp-algorithms.com/", provider: "cp-algorithms.com" },
      ],
    },
    {
      title: "Dynamic programming and greedy algorithms",
      part: PART_ALGORITHMS,
      summary: "Optimising by remembering sub-answers, and knowing when a simple greedy choice is enough.",
      subtopics: [
        "Overlapping subproblems and optimal substructure",
        "Top-down (memoisation) vs bottom-up (tabulation)",
        "Classic problems: knapsack, LCS, edit distance, coin change",
        "Greedy choice and proving it works (or finding a counterexample)",
        "Recognising which technique a problem needs",
        "State design: choosing what the table indexes",
      ],
      prerequisites: ["Recursion, divide and conquer, backtracking", "Sorting and searching"],
      estimatedMinutes: 720,
      resources: [
        { kind: "book", title: "Algorithms — Jeff Erickson (free)", url: "https://jeffe.cs.illinois.edu/teaching/algorithms/", provider: "UIUC" },
        { kind: "article", title: "CP-Algorithms", url: "https://cp-algorithms.com/", provider: "cp-algorithms.com" },
      ],
    },
    {
      title: "Discrete math and logic for programmers",
      part: PART_ALGORITHMS,
      summary: "The maths that shows up in real code: proofs, counting, probability, and modular arithmetic.",
      subtopics: [
        "Propositional logic, truth tables, and boolean simplification",
        "Sets, relations and functions",
        "Induction and proving a loop or recursion correct",
        "Counting and basic probability",
        "Modular arithmetic and number representation",
        "Graph theory vocabulary",
      ],
      prerequisites: ["Complexity and Big-O"],
      estimatedMinutes: 540,
      resources: [
        { kind: "book", title: "Mathematics for Computer Science (MIT)", url: "https://courses.csail.mit.edu/6.042/spring18/mcs.pdf", provider: "MIT" },
      ],
    },

    // ---- Part 4 ------------------------------------------------------
    {
      title: "Debugging as a method",
      part: PART_CRAFT,
      summary: "Finding bugs by procedure, not by hope — probably the biggest single skill gap in self-taught programmers.",
      subtopics: [
        "Reproduce, isolate, hypothesise, test: the loop",
        "Reading stack traces, and rubber-duck debugging",
        "Using a debugger (gdb/lldb): breakpoints, watchpoints, stepping",
        "Sanitizers: AddressSanitizer and UndefinedBehaviorSanitizer",
        "Bisecting: with git bisect and by deleting code",
        "Undefined behaviour: what it is and why it's the worst kind of bug",
      ],
      prerequisites: ["Ownership, RAII and smart pointers"],
      estimatedMinutes: 480,
      resources: [
        { kind: "article", title: "AddressSanitizer", url: "https://github.com/google/sanitizers/wiki/AddressSanitizer", provider: "Google" },
        { kind: "course", title: "The Missing Semester: debugging and profiling", url: "https://missing.csail.mit.edu/2020/debugging-profiling/", provider: "MIT" },
      ],
    },
    {
      title: "Testing: unit tests, TDD and edge cases",
      part: PART_CRAFT,
      summary: "Proving code works, and designing code that is easy to prove.",
      subtopics: [
        "Unit tests with a framework (Catch2 / GoogleTest)",
        "Arrange–act–assert, and what makes a test good",
        "Edge cases: empty, one, huge, negative, duplicates, invalid",
        "Test-driven development: red, green, refactor",
        "Testable design: seams, dependency injection",
        "Integration tests, test doubles, and the test pyramid",
      ],
      prerequisites: ["Const, errors and exceptions"],
      estimatedMinutes: 480,
      resources: [
        { kind: "article", title: "GoogleTest documentation", url: "https://google.github.io/googletest/", provider: "Google" },
        { kind: "article", title: "Catch2", url: "https://github.com/catchorg/Catch2", provider: "GitHub" },
      ],
    },
    {
      title: "Readable code and refactoring",
      part: PART_CRAFT,
      summary: "Writing code a human can understand next month, and improving it safely.",
      subtopics: [
        "Naming: what good names do and bad names cost",
        "Small functions, clear control flow, and early returns",
        "Comments: why, not what; and doc comments that explain a function's contract to the next reader",
        "Code smells: duplication, long functions, feature envy, primitive obsession",
        "Refactoring in small steps with tests as a safety net",
        "Formatting, linting and static analysis (clang-format, clang-tidy)",
      ],
      prerequisites: ["Testing: unit tests, TDD and edge cases"],
      estimatedMinutes: 480,
      resources: [CORE_GUIDELINES],
    },
    {
      title: "Templates, generics and concepts",
      part: PART_CRAFT,
      summary: "Writing code once for many types, and constraining it so errors stay readable.",
      subtopics: [
        "Function and class templates",
        "Template argument deduction",
        "C++20 concepts: constraining what a template accepts",
        "Type traits and static_assert",
        "Compile-time computation with constexpr",
        "Templates vs inheritance: static vs dynamic polymorphism",
      ],
      prerequisites: ["Move semantics and the rule of 0/3/5", "The STL: containers, iterators, algorithms, lambdas"],
      estimatedMinutes: 600,
      resources: [LEARNCPP, CPPREFERENCE],
    },
    {
      title: "Reading and reviewing code",
      part: PART_CRAFT,
      summary: "Most of a career is reading other people's code. Practise it deliberately.",
      subtopics: [
        "Reading an unfamiliar codebase: entry points, tracing, notes",
        "What a good review looks for: correctness, clarity, tests, risk",
        "Giving feedback that's specific and kind",
        "Receiving review without defensiveness",
        "Spotting bugs by reading: concurrency, off-by-ones, ownership",
        "Reading a well-regarded open-source project end to end",
      ],
      prerequisites: ["Readable code and refactoring"],
      estimatedMinutes: 360,
      resources: [
        { kind: "article", title: "Google Engineering Practices: code review", url: "https://google.github.io/eng-practices/review/", provider: "Google" },
      ],
    },
    {
      title: "Learning a library from its source",
      part: PART_CRAFT,
      summary:
        "When the documentation is thin or wrong, the code is the documentation. A method for finding what a library offers and how to use it, then judging whether to depend on it.",
      subtopics: [
        "A method: README → public headers → examples → tests → the implementation",
        "Finding the public API: installed headers, namespaces, and what's exported vs internal",
        "Reading tests and examples as the most reliable documentation",
        "Tracing one call from the public API all the way down to where the work happens",
        "Reading the library's conventions: ownership, error handling, naming, threading",
        "Reading the C++ standard library itself (e.g. how std::vector grows) and what it teaches",
        "Judging a dependency: maintenance, tests, size, licence, how hard it is to replace",
        "Wrapping a library behind your own interface so you can swap it later",
        "Practice: learn a small unfamiliar library from source alone, then write a short usage guide",
      ],
      prerequisites: [
        "Reading documentation and navigating source code",
        "Reading and reviewing code",
        "Templates, generics and concepts",
      ],
      estimatedMinutes: 540,
      resources: [
        { kind: "article", title: "clangd: C++ code intelligence", url: "https://clangd.llvm.org/", provider: "LLVM" },
        CPPREFERENCE,
      ],
    },

    // ---- Part 5 ------------------------------------------------------
    {
      title: "SOLID, coupling and cohesion",
      part: PART_DESIGN,
      summary: "The principles behind code that is easy to change — and the judgement to know when they don't apply.",
      subtopics: [
        "Coupling and cohesion: the two dials of design",
        "Single responsibility and separation of concerns",
        "Open/closed, Liskov substitution",
        "Interface segregation and dependency inversion",
        "Law of Demeter, tell don't ask, information hiding",
        "When to ignore a principle: over-engineering and YAGNI",
      ],
      prerequisites: ["Structs and classes: building your own types", "Readable code and refactoring"],
      estimatedMinutes: 480,
      resources: [CORE_GUIDELINES],
    },
    {
      title: "OOP, functional and data-oriented design",
      part: PART_DESIGN,
      summary: "Three ways to organise a program, and how to choose between them.",
      subtopics: [
        "Object-oriented design: objects, messages, polymorphism",
        "Composition over inheritance",
        "Functional ideas in C++: pure functions, immutability, transformations",
        "Data-oriented design: layout for the cache, structs of arrays",
        "Value semantics vs reference semantics",
        "Choosing a style for the problem in front of you",
      ],
      prerequisites: ["Templates, generics and concepts", "SOLID, coupling and cohesion"],
      estimatedMinutes: 480,
      resources: [CORE_GUIDELINES],
    },
    {
      title: "Design patterns that matter",
      part: PART_DESIGN,
      summary: "A shared vocabulary of solutions — learnt as tools, not as a checklist.",
      subtopics: [
        "Strategy, and the function-object alternative",
        "Observer and event systems",
        "Factory and builder",
        "Adapter, decorator and facade",
        "State machines and command",
        "RAII, pimpl and other C++-specific idioms",
        "Anti-patterns: singleton overuse, god objects",
      ],
      prerequisites: ["OOP, functional and data-oriented design"],
      estimatedMinutes: 540,
      resources: [
        { kind: "article", title: "Refactoring Guru: Design Patterns", url: "https://refactoring.guru/design-patterns", provider: "refactoring.guru" },
      ],
    },
    {
      title: "API and interface design",
      part: PART_DESIGN,
      summary: "Designing the surface other code (and other people) touches: easy to use right, hard to use wrong.",
      subtopics: [
        "What makes an interface good: small, consistent, hard to misuse",
        "Naming, parameters, return types and ownership in signatures",
        "Error reporting as part of the contract",
        "Versioning and backwards compatibility",
        "Designing a library vs designing an application",
        "Documenting an API with examples",
      ],
      prerequisites: ["SOLID, coupling and cohesion"],
      estimatedMinutes: 420,
      resources: [CORE_GUIDELINES],
    },
    {
      title: "Software architecture",
      part: PART_DESIGN,
      summary: "Structuring a whole system: layers, boundaries and the direction dependencies point.",
      subtopics: [
        "Layered, hexagonal (ports and adapters) and clean architecture",
        "Module boundaries and dependency direction",
        "Monolith vs services, and what changes",
        "Cross-cutting concerns: logging, configuration, errors",
        "Architecture decision records: writing down why",
        "Evolving a design: when to restructure",
      ],
      prerequisites: ["Design patterns that matter", "API and interface design"],
      estimatedMinutes: 540,
      resources: [
        { kind: "article", title: "Hexagonal architecture — Alistair Cockburn", url: "https://alistair.cockburn.us/hexagonal-architecture/", provider: "Alistair Cockburn" },
        { kind: "book", title: "Software Engineering at Google", url: "https://abseil.io/resources/swe-book", provider: "Google" },
      ],
    },
    {
      title: "Domain modelling and design docs",
      part: PART_DESIGN,
      summary: "Turning a vague problem into a design, and writing it down so others can challenge it.",
      subtopics: [
        "Finding the entities, rules and vocabulary of a problem",
        "Modelling state and invariants in types",
        "Sketching alternatives and recording trade-offs",
        "Writing a design doc: goals, non-goals, options, decision",
        "Breaking a design into milestones",
        "Design review: defending and revising a design",
      ],
      prerequisites: ["Software architecture"],
      estimatedMinutes: 420,
      resources: [
        { kind: "book", title: "Software Engineering at Google", url: "https://abseil.io/resources/swe-book", provider: "Google" },
      ],
    },

    // ---- Part 6 ------------------------------------------------------
    {
      title: "Computer architecture and performance",
      part: PART_MACHINE,
      summary: "How the hardware actually executes your code, and why some code is fast.",
      subtopics: [
        "The CPU pipeline, registers, and instructions",
        "The memory hierarchy: cache lines, locality, misses",
        "Why arrays beat linked lists in practice",
        "Branch prediction and what a mispredict costs",
        "Data layout, padding and alignment",
        "Reading simple assembly on Compiler Explorer",
      ],
      prerequisites: ["References, pointers and the stack vs the heap"],
      estimatedMinutes: 540,
      resources: [
        { kind: "course", title: "Nand2Tetris: build a computer from first principles", url: "https://www.nand2tetris.org/", provider: "nand2tetris.org" },
        GODBOLT,
      ],
    },
    {
      title: "Operating systems",
      part: PART_MACHINE,
      summary: "What sits between your program and the hardware, and what you can ask of it.",
      subtopics: [
        "Processes, threads, and scheduling",
        "Virtual memory, paging, and the heap's real source",
        "System calls, and files and file descriptors",
        "Signals, pipes and inter-process communication",
        "Permissions and isolation",
        "Writing a small program that uses the OS directly (POSIX)",
      ],
      prerequisites: ["Computer architecture and performance"],
      estimatedMinutes: 600,
      resources: [
        { kind: "book", title: "Operating Systems: Three Easy Pieces", url: "https://pages.cs.wisc.edu/~remzi/OSTEP/", provider: "UW–Madison" },
        { kind: "article", title: "Linux man pages", url: "https://man7.org/linux/man-pages/", provider: "man7.org" },
      ],
    },
    {
      title: "Concurrency",
      part: PART_MACHINE,
      summary: "Doing several things at once without corrupting data — where most professional bugs hide.",
      subtopics: [
        "Threads, std::thread, and std::async",
        "Data races and why they're undefined behaviour",
        "Mutexes, lock guards and condition variables",
        "Deadlock, livelock and how to avoid them",
        "Atomics and the memory model, at a working level",
        "Thread pools, queues and sharing nothing",
        "Finding races with ThreadSanitizer",
      ],
      prerequisites: ["Operating systems", "Move semantics and the rule of 0/3/5"],
      estimatedMinutes: 720,
      resources: [CPPREFERENCE, { kind: "book", title: "Operating Systems: Three Easy Pieces — concurrency", url: "https://pages.cs.wisc.edu/~remzi/OSTEP/", provider: "UW–Madison" }],
    },
    {
      title: "Networking",
      part: PART_MACHINE,
      summary: "How machines talk, from packets to HTTP, ending with a server you wrote yourself.",
      subtopics: [
        "The layers: link, IP, TCP/UDP, application",
        "Addresses, ports, DNS",
        "TCP: connections, reliability, and what a socket is",
        "HTTP: requests, responses, headers, methods, status codes",
        "TLS in outline: what it protects",
        "Write a small TCP/HTTP server and client",
      ],
      prerequisites: ["Operating systems"],
      estimatedMinutes: 600,
      resources: [
        { kind: "book", title: "Beej's Guide to Network Programming", url: "https://beej.us/guide/bgnet/", provider: "beej.us" },
      ],
    },
    {
      title: "Compilers and interpreters",
      part: PART_MACHINE,
      summary: "How a language is implemented — which makes every language easier to learn.",
      subtopics: [
        "Lexing: turning text into tokens",
        "Parsing: grammars, recursive descent, and syntax trees",
        "Evaluating a tree: tree-walk interpreters",
        "Types and scope: what a checker does",
        "What an optimiser does to your code",
        "Build a small interpreter",
      ],
      prerequisites: ["Trees and graphs", "Templates, generics and concepts"],
      estimatedMinutes: 720,
      resources: [
        { kind: "book", title: "Crafting Interpreters (free)", url: "https://craftinginterpreters.com/", provider: "Robert Nystrom" },
      ],
    },

    // ---- Part 7 ------------------------------------------------------
    {
      title: "Databases and SQL",
      part: PART_DATA,
      summary: "Relational modelling and SQL, and what the database does underneath.",
      subtopics: [
        "Tables, keys and relations: one-to-many and many-to-many",
        "SELECT, WHERE, JOIN, GROUP BY, subqueries",
        "Normalisation, and when to denormalise",
        "Indexes: B-trees, and why a query is slow",
        "Transactions and ACID; isolation levels",
        "Reading a query plan",
        "SQL vs NoSQL, and choosing a store",
      ],
      prerequisites: ["Core data structures, built by hand"],
      estimatedMinutes: 720,
      resources: [
        { kind: "interactive", title: "SQLBolt: learn SQL interactively", url: "https://sqlbolt.com/", provider: "SQLBolt" },
        { kind: "book", title: "Use The Index, Luke", url: "https://use-the-index-luke.com/", provider: "Markus Winand" },
      ],
    },
    {
      title: "Persistence, files and serialization",
      part: PART_DATA,
      summary: "Getting data out of memory and back reliably.",
      subtopics: [
        "Files, streams and buffering",
        "Text vs binary formats, and endianness",
        "Serialisation: JSON, protobuf, and designing a format",
        "Versioning a data format",
        "Crash safety: write-ahead logs, atomic renames, fsync",
        "How a storage engine lays out data",
      ],
      prerequisites: ["Databases and SQL", "Operating systems"],
      estimatedMinutes: 480,
      resources: [CPPREFERENCE],
    },
    {
      title: "Distributed systems",
      part: PART_DATA,
      summary: "What changes when a system spans machines that can fail independently.",
      subtopics: [
        "Why distribution is hard: latency, partial failure, no shared clock",
        "Replication and consistency models",
        "CAP and its practical meaning",
        "Consensus in outline (Raft)",
        "Queues, retries and idempotency",
        "Caching and invalidation",
      ],
      prerequisites: ["Networking", "Databases and SQL"],
      estimatedMinutes: 600,
      resources: [
        { kind: "book", title: "Designing Data-Intensive Applications", url: "https://dataintensive.net/", provider: "Martin Kleppmann" },
        { kind: "interactive", title: "The Secret Lives of Data: Raft", url: "https://thesecretlivesofdata.com/raft/", provider: "thesecretlivesofdata.com" },
      ],
    },
    {
      title: "System design",
      part: PART_DATA,
      summary: "Designing a whole service to meet requirements, with numbers behind your choices.",
      subtopics: [
        "Requirements: functional, scale, latency, availability",
        "Back-of-envelope estimation",
        "Load balancing, caching, sharding, replication",
        "Choosing storage and queues",
        "Reliability: timeouts, retries, backpressure, graceful degradation",
        "Observability: logs, metrics, traces",
        "Walking through a design, e.g. a URL shortener or chat service",
      ],
      prerequisites: ["Distributed systems", "Software architecture"],
      estimatedMinutes: 600,
      resources: [
        { kind: "article", title: "The System Design Primer", url: "https://github.com/donnemartin/system-design-primer", provider: "GitHub" },
        { kind: "book", title: "Designing Data-Intensive Applications", url: "https://dataintensive.net/", provider: "Martin Kleppmann" },
      ],
    },
    {
      title: "Security for programmers",
      part: PART_DATA,
      summary: "Writing code that survives hostile input.",
      subtopics: [
        "Threat modelling: assets, attackers, trust boundaries",
        "Memory-safety bugs in C++: overflows, use-after-free, and how they're exploited",
        "Input validation and injection (SQL, command, path)",
        "Authentication and authorisation basics; storing passwords",
        "Cryptography: what to use and never to roll yourself",
        "Dependencies and supply chain",
      ],
      prerequisites: ["Networking", "Computer architecture and performance"],
      estimatedMinutes: 480,
      resources: [
        { kind: "article", title: "OWASP Top Ten", url: "https://owasp.org/www-project-top-ten/", provider: "OWASP" },
      ],
    },

    // ---- Part 8 ------------------------------------------------------
    {
      title: "Build systems, tooling and CI",
      part: PART_PRACTICE,
      summary: "Everything between your source and a shipped program.",
      subtopics: [
        "Headers, translation units, and the linker, properly",
        "CMake: targets, options, and dependencies",
        "Package managers and third-party libraries",
        "Git workflow: branches, rebasing, resolving conflicts, good commits",
        "Continuous integration: build, test, lint on every push",
        "Debug vs release builds, warnings as errors, sanitizer builds",
      ],
      prerequisites: ["Testing: unit tests, TDD and edge cases"],
      estimatedMinutes: 480,
      resources: [
        { kind: "book", title: "An Introduction to Modern CMake", url: "https://cliutils.gitlab.io/modern-cmake/", provider: "cliutils" },
        { kind: "book", title: "Pro Git", url: "https://git-scm.com/book/en/v2", provider: "git-scm.com" },
      ],
    },
    {
      title: "Performance engineering",
      part: PART_PRACTICE,
      summary: "Making code fast on purpose: measure first, then change one thing.",
      subtopics: [
        "Measure first: profilers, benchmarks, and noisy measurements",
        "Finding the hot spot (perf, flame graphs)",
        "Algorithmic wins before micro-optimisation",
        "Memory and cache-friendly changes",
        "Avoiding allocation and copying",
        "Knowing when to stop",
      ],
      prerequisites: ["Computer architecture and performance", "Complexity and Big-O"],
      estimatedMinutes: 480,
      resources: [
        { kind: "interactive", title: "Quick C++ Benchmarks", url: "https://quick-bench.com/", provider: "quick-bench.com" },
        GODBOLT,
      ],
    },
    {
      title: "Working in teams and over time",
      part: PART_PRACTICE,
      summary: "The skills that separate a senior engineer from a fast coder.",
      subtopics: [
        "Estimating work, and communicating uncertainty",
        "Writing for engineers: docs, READMEs, commit messages",
        "Working in a legacy codebase: characterisation tests and safe change",
        "Technical debt: deciding what to pay down",
        "Mentoring, asking good questions, and disagreeing well",
        "Operating what you ship: on-call, incidents and postmortems",
      ],
      prerequisites: ["Reading and reviewing code"],
      estimatedMinutes: 360,
      resources: [
        { kind: "book", title: "Software Engineering at Google", url: "https://abseil.io/resources/swe-book", provider: "Google" },
      ],
    },
    {
      title: "Capstone projects",
      part: PART_PRACTICE,
      summary: "Build whole systems from a blank page: design doc first, then milestones with tests.",
      subtopics: [
        "Capstone 1: an expression parser and interpreter",
        "Capstone 2: a persistent key-value store with a write-ahead log",
        "Capstone 3: an HTTP server with a thread pool",
        "Capstone 4: a multithreaded task scheduler",
        "Write a design doc for each before coding",
        "Review your own capstones and refactor them",
      ],
      prerequisites: ["Domain modelling and design docs", "Concurrency", "Compilers and interpreters", "Persistence, files and serialization", "Performance engineering"],
      estimatedMinutes: 2400,
      resources: [],
    },
  ],
};
