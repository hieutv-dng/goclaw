import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveStackProfile } from "../stack-profiles/index.js";
import { withErrorHandler, getChainHint } from "../shared/index.js";

// ─────────────────────────────────────────────
// Template Generator
//
// Sinh boilerplate code cho feature mới
// tùy theo stack: Angular, Spring, NestJS,
// Flutter, React.
// ─────────────────────────────────────────────

// Template definitions per stack — lazy to avoid 'used before declaration'
function getTemplates(): Record<string, FeatureTemplate[]> {
  return {
  angular: [
    {
      name: "component",
      files: [
        { path: "{name}/{name}.component.ts", content: ANGULAR_COMPONENT },
        { path: "{name}/{name}.component.html", content: ANGULAR_HTML },
        { path: "{name}/{name}.component.scss", content: ANGULAR_SCSS },
        { path: "{name}/{name}.component.spec.ts", content: ANGULAR_SPEC },
      ],
    },
    {
      name: "service",
      files: [
        { path: "{name}/{name}.service.ts", content: ANGULAR_SERVICE },
        { path: "{name}/{name}.service.spec.ts", content: ANGULAR_SERVICE_SPEC },
      ],
    },
  ],
  nestjs: [
    {
      name: "module",
      files: [
        { path: "{name}/{name}.controller.ts", content: NEST_CONTROLLER },
        { path: "{name}/{name}.service.ts", content: NEST_SERVICE },
        { path: "{name}/{name}.module.ts", content: NEST_MODULE },
        { path: "{name}/{name}.dto.ts", content: NEST_DTO },
      ],
    },
  ],
  react: [
    {
      name: "component",
      files: [
        { path: "{name}/{Name}.tsx", content: REACT_COMPONENT },
        { path: "{name}/{Name}.test.tsx", content: REACT_TEST },
        { path: "{name}/index.ts", content: REACT_INDEX },
      ],
    },
  ],
  flutter: [
    {
      name: "feature",
      files: [
        { path: "{name}/screens/{name}_screen.dart", content: FLUTTER_SCREEN },
        { path: "{name}/bloc/{name}_bloc.dart", content: FLUTTER_BLOC },
        { path: "{name}/models/{name}_model.dart", content: FLUTTER_MODEL },
        { path: "{name}/repositories/{name}_repository.dart", content: FLUTTER_REPO },
      ],
    },
  ],
  spring: [
    {
      name: "feature",
      files: [
        { path: "{name}/{Name}Controller.java", content: SPRING_CONTROLLER },
        { path: "{name}/{Name}Service.java", content: SPRING_SERVICE },
        { path: "{name}/{Name}Repository.java", content: SPRING_REPOSITORY },
        { path: "{name}/dto/{Name}Dto.java", content: SPRING_DTO },
      ],
    },
  ],
  };
}

interface FeatureTemplate {
  name: string;
  files: Array<{ path: string; content: string }>;
}

export function registerTemplateTools(server: McpServer) {

  server.tool(
    "generate_template",
    "Sinh boilerplate code cho feature mới theo stack. " +
    "VD: Angular → component+service+spec, NestJS → controller+service+module+dto. " +
    "⚠️ PHẢI hỏi user xác nhận TRƯỚC KHI tạo file.",
    {
      featureName: z.string()
        .describe("Tên feature. VD: 'user-profile', 'payment', 'auth'"),
      templateType: z.string().default("component")
        .describe("Loại template: 'component', 'service', 'module', 'feature'"),
      projectRoot: z.string()
        .describe("Đường dẫn project root"),
      targetDir: z.string().optional()
        .describe("Thư mục đích. Nếu bỏ trống → dùng default theo stack"),
      stack: z.enum(["auto", "angular", "spring", "nestjs", "flutter", "react", "generic"])
        .default("auto")
        .describe("Tech stack"),
    },
    withErrorHandler("generate_template", async ({ featureName, templateType, projectRoot, targetDir, stack }) => {

      const profile = await resolveStackProfile(stack, projectRoot);
      const stackTemplates = getTemplates()[profile.name];

      if (!stackTemplates) {
        return {
          content: [{
            type: "text",
            text: [
              `# ❌ Không có template cho stack: ${profile.displayName}`,
              "",
              "Stacks hỗ trợ: Angular, NestJS, React, Flutter, Spring Boot.",
            ].join("\n") + getChainHint("generate_template"),
          }],
        };
      }

      // Find matching template
      const template = stackTemplates.find(t => t.name === templateType)
        ?? stackTemplates[0]; // Fallback to first template

      const kebab = featureName.toLowerCase().replace(/\s+/g, "-");
      const pascal = kebab.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join("");
      const camel = pascal[0].toLowerCase() + pascal.slice(1);

      const defaultDir = getDefaultDir(profile.name);
      const baseDir = targetDir ?? `${defaultDir}/${kebab}`;

      // Generate file contents
      const generatedFiles = template.files.map(f => ({
        relativePath: f.path
          .replace(/\{name\}/g, kebab)
          .replace(/\{Name\}/g, pascal),
        content: f.content
          .replace(/\{name\}/g, kebab)
          .replace(/\{Name\}/g, pascal)
          .replace(/\{camelName\}/g, camel),
      }));

      const lines = [
        `# 📦 Template Generated — ${profile.displayName}`,
        "",
        `**Feature:** ${featureName}`,
        `**Type:** ${template.name}`,
        `**Base dir:** \`${baseDir}\``,
        "",
        `## Files sẽ được tạo (${generatedFiles.length})`,
        "",
        ...generatedFiles.map(f => `### \`${baseDir}/${f.relativePath}\``),
        "",
        "## Preview code",
        "",
        ...generatedFiles.map(f => [
          `### \`${f.relativePath}\``,
          "```" + getExtLang(f.relativePath),
          f.content,
          "```",
          "",
        ].join("\n")),
        "---",
        "⚠️ **Xác nhận:** Bạn có muốn tạo các file trên không?",
        `📌 Sau khi tạo → \`detect_files_from_task\` để cập nhật context.`,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") + getChainHint("generate_template") }],
      };
    })
  );
}

// ── Helpers ──────────────────────────────────

function getDefaultDir(stack: string): string {
  const map: Record<string, string> = {
    angular: "src/app/features",
    react: "src/components",
    nestjs: "src/modules",
    flutter: "lib/features",
    spring: "src/main/java/com/example",
  };
  return map[stack] ?? "src";
}

function getExtLang(filename: string): string {
  if (filename.endsWith(".ts") || filename.endsWith(".tsx")) return "typescript";
  if (filename.endsWith(".java")) return "java";
  if (filename.endsWith(".dart")) return "dart";
  if (filename.endsWith(".html")) return "html";
  if (filename.endsWith(".scss")) return "scss";
  return "";
}

// ─────────────────────────────────────────────
// Template contents — minimal but functional
// ─────────────────────────────────────────────

// Angular
const ANGULAR_COMPONENT = `import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-{name}',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './{name}.component.html',
  styleUrls: ['./{name}.component.scss'],
})
export class {Name}Component implements OnInit {

  ngOnInit(): void {
    // TODO: Initialize component
  }
}`;

const ANGULAR_HTML = `<div class="{name}-container">
  <h2>{Name}</h2>
  <!-- TODO: Add template content -->
</div>`;

const ANGULAR_SCSS = `.{name}-container {
  // TODO: Add styles
}`;

const ANGULAR_SPEC = `import { ComponentFixture, TestBed } from '@angular/core/testing';
import { {Name}Component } from './{name}.component';

describe('{Name}Component', () => {
  let component: {Name}Component;
  let fixture: ComponentFixture<{Name}Component>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [{Name}Component],
    }).compileComponents();

    fixture = TestBed.createComponent({Name}Component);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});`;

const ANGULAR_SERVICE = `import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class {Name}Service {

  constructor(private http: HttpClient) {}

  // TODO: Add service methods
}`;

const ANGULAR_SERVICE_SPEC = `import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { {Name}Service } from './{name}.service';

describe('{Name}Service', () => {
  let service: {Name}Service;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
    });
    service = TestBed.inject({Name}Service);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});`;

// NestJS
const NEST_CONTROLLER = `import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { {Name}Service } from './{name}.service';
import { Create{Name}Dto } from './{name}.dto';

@Controller('{name}')
export class {Name}Controller {
  constructor(private readonly {camelName}Service: {Name}Service) {}

  @Get()
  findAll() {
    return this.{camelName}Service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.{camelName}Service.findOne(id);
  }

  @Post()
  create(@Body() dto: Create{Name}Dto) {
    return this.{camelName}Service.create(dto);
  }
}`;

const NEST_SERVICE = `import { Injectable } from '@nestjs/common';
import { Create{Name}Dto } from './{name}.dto';

@Injectable()
export class {Name}Service {

  findAll() {
    // TODO: Implement
    return [];
  }

  findOne(id: string) {
    // TODO: Implement
    return { id };
  }

  create(dto: Create{Name}Dto) {
    // TODO: Implement
    return dto;
  }
}`;

const NEST_MODULE = `import { Module } from '@nestjs/common';
import { {Name}Controller } from './{name}.controller';
import { {Name}Service } from './{name}.service';

@Module({
  controllers: [{Name}Controller],
  providers: [{Name}Service],
  exports: [{Name}Service],
})
export class {Name}Module {}`;

const NEST_DTO = `export class Create{Name}Dto {
  // TODO: Define DTO fields
}

export class Update{Name}Dto {
  // TODO: Define DTO fields
}`;

// React
const REACT_COMPONENT = `import React from 'react';

interface {Name}Props {
  // TODO: Define props
}

export const {Name}: React.FC<{Name}Props> = (props) => {
  return (
    <div className="{name}">
      <h2>{Name}</h2>
      {/* TODO: Add component content */}
    </div>
  );
};`;

const REACT_TEST = `import { render, screen } from '@testing-library/react';
import { {Name} } from './{Name}';

describe('{Name}', () => {
  it('renders correctly', () => {
    render(<{Name} />);
    expect(screen.getByText('{Name}')).toBeInTheDocument();
  });
});`;

const REACT_INDEX = `export { {Name} } from './{Name}';`;

// Flutter
const FLUTTER_SCREEN = `import 'package:flutter/material.dart';

class {Name}Screen extends StatelessWidget {
  const {Name}Screen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('{Name}')),
      body: const Center(
        child: Text('TODO: Implement {Name}'),
      ),
    );
  }
}`;

const FLUTTER_BLOC = `// TODO: Add flutter_bloc dependency
// import 'package:flutter_bloc/flutter_bloc.dart';

class {Name}State {
  // TODO: Define state
}

class {Name}Cubit {
  // TODO: Implement cubit/bloc
}`;

const FLUTTER_MODEL = `class {Name}Model {
  final String id;

  {Name}Model({required this.id});

  factory {Name}Model.fromJson(Map<String, dynamic> json) {
    return {Name}Model(id: json['id'] as String);
  }

  Map<String, dynamic> toJson() => {'id': id};
}`;

const FLUTTER_REPO = `import '../models/{name}_model.dart';

class {Name}Repository {
  Future<List<{Name}Model>> getAll() async {
    // TODO: Implement API call
    return [];
  }

  Future<{Name}Model?> getById(String id) async {
    // TODO: Implement
    return null;
  }
}`;

// Spring Boot
const SPRING_CONTROLLER = `package com.example.{name};

import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/{name}")
public class {Name}Controller {

    private final {Name}Service {camelName}Service;

    public {Name}Controller({Name}Service {camelName}Service) {
        this.{camelName}Service = {camelName}Service;
    }

    @GetMapping
    public List<Object> findAll() {
        return {camelName}Service.findAll();
    }

    @GetMapping("/{id}")
    public Object findById(@PathVariable Long id) {
        return {camelName}Service.findById(id);
    }

    @PostMapping
    public Object create(@RequestBody {Name}Dto dto) {
        return {camelName}Service.create(dto);
    }
}`;

const SPRING_SERVICE = `package com.example.{name};

import org.springframework.stereotype.Service;
import java.util.List;
import java.util.ArrayList;

@Service
public class {Name}Service {

    public List<Object> findAll() {
        // TODO: Implement
        return new ArrayList<>();
    }

    public Object findById(Long id) {
        // TODO: Implement
        return null;
    }

    public Object create({Name}Dto dto) {
        // TODO: Implement
        return dto;
    }
}`;

const SPRING_REPOSITORY = `package com.example.{name};

// import org.springframework.data.jpa.repository.JpaRepository;

public interface {Name}Repository /* extends JpaRepository<{Name}Entity, Long> */ {
    // TODO: Define repository methods
}`;

const SPRING_DTO = `package com.example.{name}.dto;

public class {Name}Dto {
    // TODO: Define DTO fields

    public {Name}Dto() {}
}`;
